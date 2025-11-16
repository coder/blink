import { expect, test } from "bun:test";
import { Client } from "@blink-sdk/compute-protocol/client";
import Multiplexer, { Stream } from "@blink-sdk/multiplexer";
import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import WebSocket from "ws";
import type { WebSocketServer } from "ws";
import serveCompute from "./compute-server";

type RawData = WebSocket.RawData;

interface RemoteClient {
  client: Client;
  close: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const rawDataToUint8Array = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) {
    return rawDataToUint8Array(Buffer.concat(data));
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
};

const createRemoteClient = (url: string): Promise<RemoteClient> => {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const multiplexer = new Multiplexer({
      send: (packet) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(packet);
        }
      },
      isClient: true,
    });
    const clientStream = multiplexer.createStream();
    const client = new Client({
      send: (message: string) => {
        clientStream.writeTyped(0x00, encoder.encode(message), true);
      },
    });

    const wireStream = (stream: Stream) => {
      stream.onData((data) => {
        const payload = data.subarray(1);
        client.handleMessage(decoder.decode(payload));
      });
    };

    wireStream(clientStream);
    multiplexer.onStream((stream) => {
      wireStream(stream);
    });

    ws.on("message", (data) => {
      multiplexer.handleMessage(rawDataToUint8Array(data));
    });
    ws.on("open", () => {
      settled = true;
      resolve({
        client,
        close: async () => {
          await new Promise<void>((resolveClose) => {
            if (ws.readyState === WebSocket.CLOSED) {
              resolveClose();
              return;
            }
            ws.once("close", () => resolveClose());
            ws.close();
          });
        },
      });
    });
    ws.on("error", (err) => {
      if (!settled) {
        reject(err);
      }
    });
    ws.on("close", () => {
      client.dispose("connection closed");
    });
  });
};

const closeServer = async (wss: WebSocketServer) => {
  await new Promise<void>((resolve, reject) => {
    wss.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const getAvailablePort = async (host: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
};

const buildTestServer = async () => {
  const host = "127.0.0.1";
  const port = await getAvailablePort(host);
  const server = await serveCompute({
    host,
    port,
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine server address");
  }
  const url = `ws://${host}:${address.port}`;
  return {
    server,
    url,
    close: () => closeServer(server),
  };
};

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs = 5_000
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error("Condition not met within timeout");
};

test("multiple clients share the same compute server state", async () => {
  const { server, url, close } = await buildTestServer();

  const remoteA = await createRemoteClient(url);
  const remoteB = await createRemoteClient(url);

  const observedPids: number[] = [];
  const notificationDisposable = remoteB.client.onNotification(
    "process_status",
    (payload) => {
      observedPids.push(payload.status.pid);
    }
  );

  const exec = await remoteA.client.request("process_execute", {
    command: "bash",
    args: ["-lc", 'echo "shared-process"'],
    cwd: ".",
  });

  const waitResult = await remoteB.client.request("process_wait", {
    pid: exec.pid,
    timeout_ms: 10_000,
  });

  expect(waitResult.pid).toBe(exec.pid);
  expect(waitResult.plain_output.lines.join("\n")).toContain("shared-process");
  expect(observedPids).toContain(exec.pid);

  notificationDisposable.dispose();
  await Promise.all([remoteA.close(), remoteB.close()]);
  await close();
});

test("broadcasts process output notifications to all clients", async () => {
  const { server, url, close } = await buildTestServer();
  const remoteA = await createRemoteClient(url);
  const remoteB = await createRemoteClient(url);
  const remoteC = await createRemoteClient(url);

  const outputsB: string[] = [];
  const outputsC: string[] = [];
  const disposeB = remoteB.client.onNotification("process_output", (payload) =>
    outputsB.push(payload.output)
  );
  const disposeC = remoteC.client.onNotification("process_output", (payload) =>
    outputsC.push(payload.output)
  );

  const exec = await remoteA.client.request("process_execute", {
    command: "bash",
    args: ["-lc", 'printf "fanout"; sleep 0.1'],
    cwd: ".",
  });
  await remoteA.client.request("process_wait", {
    pid: exec.pid,
    timeout_ms: 5_000,
  });

  await waitForCondition(
    () =>
      outputsB.join("").includes("fanout") &&
      outputsC.join("").includes("fanout")
  );

  disposeB.dispose();
  disposeC.dispose();
  await Promise.all([remoteA.close(), remoteB.close(), remoteC.close()]);
  await close();
});

test("process remains accessible after originating client disconnects", async () => {
  const { server, url, close } = await buildTestServer();
  const remoteA = await createRemoteClient(url);
  const remoteB = await createRemoteClient(url);

  const exec = await remoteA.client.request("process_execute", {
    command: "bash",
    args: ["-lc", 'sleep 0.2; echo "still-running"'],
    cwd: ".",
  });

  await remoteA.close(); // disconnect before waiting

  const result = await remoteB.client.request("process_wait", {
    pid: exec.pid,
    timeout_ms: 10_000,
  });

  expect(result.plain_output.lines.join("\n")).toContain("still-running");

  await remoteB.close();
  await close();
});

test("handles many sequential streams without collisions", async () => {
  const { server, url, close } = await buildTestServer();
  const remote = await createRemoteClient(url);

  const promises = [];

  for (let i = 0; i < 10; i++) {
    promises.push(
      (async () => {
        const marker = `seq-${i}`;
        const exec = await remote.client.request("process_execute", {
          command: "bash",
          args: ["-lc", `echo "${marker}"`],
          cwd: ".",
        });
        const waitResult = await remote.client.request("process_wait", {
          pid: exec.pid,
          timeout_ms: 5_000,
        });
        return { marker, output: waitResult.plain_output.lines.join("\n") };
      })()
    );
  }

  for (const promise of promises) {
    const { marker, output } = await promise;
    expect(output).toContain(marker);
  }

  await remote.close();
  await close();
});
