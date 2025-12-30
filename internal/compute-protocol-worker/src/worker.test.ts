import { Server } from "@blink-sdk/compute-protocol/server";
import { expect, test } from "bun:test";
import { Worker } from "./worker";

test("proxy simple requests", async () => {
  const { worker } = createWorkerServer();
  const { url } = Bun.serve({
    port: 0,
    fetch: (request) => {
      return new Response("Hello!");
    },
  });
  const response = await worker.proxy(
    new Request(url, {
      method: "GET",
    })
  );
  const resp = new Response(response.body);
  const text = await resp.text();
  expect(text).toBe("Hello!");
});

test("proxy POST request with body", async () => {
  const { worker } = createWorkerServer();
  let receivedBody = "";
  const receivedHeaders: Record<string, string> = {};
  const { url } = Bun.serve({
    port: 0,
    fetch: async (request) => {
      receivedBody = await request.text();
      request.headers.forEach((value, key) => {
        receivedHeaders[key] = value;
      });
      return new Response(`Received: ${receivedBody}`);
    },
  });

  const response = await worker.proxy(
    new Request(url, {
      method: "POST",
      body: "test data",
      headers: { "Content-Type": "text/plain" },
    })
  );

  const resp = new Response(response.body);
  const text = await resp.text();
  expect(text).toBe("Received: test data");
  expect(receivedHeaders["content-type"]).toBe("text/plain");
});

test("proxy PUT request with JSON body", async () => {
  const { worker } = createWorkerServer();
  let receivedData: any;
  const { url } = Bun.serve({
    port: 0,
    fetch: async (request) => {
      receivedData = await request.json();
      return new Response(
        JSON.stringify({ success: true, received: receivedData }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    },
  });

  const testData = { name: "test", value: 42 };
  const response = await worker.proxy(
    new Request(url, {
      method: "PUT",
      body: JSON.stringify(testData),
      headers: { "Content-Type": "application/json" },
    })
  );

  const resp = new Response(response.body);
  const result = await resp.json();
  expect(result.success).toBe(true);
  expect(result.received).toEqual(testData);
});

test("proxy error responses", async () => {
  const { worker } = createWorkerServer();
  const { url } = Bun.serve({
    port: 0,
    fetch: () =>
      new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      }),
  });

  const response = await worker.proxy(new Request(url));
  const resp = new Response(response.body);
  expect(response.status).toBe(404);
  expect(response.statusText).toBe("Not Found");
  expect(await resp.text()).toBe("Not Found");
});

test("proxy server error responses", async () => {
  const { worker } = createWorkerServer();
  const { url } = Bun.serve({
    port: 0,
    fetch: () =>
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "X-Error-Code": "INTERNAL_ERROR" },
      }),
  });

  const response = await worker.proxy(new Request(url));
  expect(response.status).toBe(500);
  expect(response.statusText).toBe("Internal Server Error");
  expect(response.headers.get("X-Error-Code")).toBe("INTERNAL_ERROR");
  const resp = new Response(response.body);
  expect(await resp.text()).toBe("Internal Server Error");
});

test("proxy websocket upgrade failure", async () => {
  const { worker } = createWorkerServer();
  const { url } = Bun.serve({
    port: 0,
    fetch: () => new Response("Upgrade failed", { status: 400 }),
  });

  const response = await worker.proxy(
    new Request(url, {
      headers: { Upgrade: "websocket" },
    })
  );

  expect(response.status).toBe(400);
  expect(response.statusText).toBe("Expected 101 status code");
});

test("proxy streaming request body", async () => {
  const { worker } = createWorkerServer();
  let receivedData = "";
  const { url } = Bun.serve({
    port: 0,
    fetch: async (request) => {
      receivedData = await request.text();
      return new Response("OK");
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("chunk1"));
      controller.enqueue(new TextEncoder().encode("chunk2"));
      controller.close();
    },
  });

  const response = await worker.proxy(
    new Request(url, { method: "POST", body: stream })
  );
  const resp = new Response(response.body);
  expect(await resp.text()).toBe("OK");
  expect(receivedData).toBe("chunk1chunk2");
});

test("proxy request with no body", async () => {
  const { worker } = createWorkerServer();
  let bodyIsEmpty = false;
  const { url } = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (request.body) {
        const reader = request.body.getReader();
        const result = await reader.read();
        bodyIsEmpty = result.done && !result.value;
      } else {
        bodyIsEmpty = true;
      }
      return new Response("OK");
    },
  });

  const response = await worker.proxy(new Request(url, { method: "POST" }));

  const resp = new Response(response.body);
  expect(await resp.text()).toBe("OK");
  expect(bodyIsEmpty).toBe(true);
});

test("proxy request with empty string body", async () => {
  const { worker } = createWorkerServer();
  let receivedBody = "not-empty";
  const { url } = Bun.serve({
    port: 0,
    fetch: async (request) => {
      receivedBody = await request.text();
      return new Response("OK");
    },
  });

  const response = await worker.proxy(
    new Request(url, {
      method: "POST",
      body: "",
    })
  );

  const resp = new Response(response.body);
  expect(await resp.text()).toBe("OK");
  expect(receivedBody).toBe("");
});

test("proxy websocket with protocol negotiation", async () => {
  const { worker } = createWorkerServer();
  let negotiatedProtocol = "";

  const { url } = Bun.serve({
    port: 0,
    fetch: (req, server) => {
      negotiatedProtocol = req.headers.get("sec-websocket-protocol") || "";
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        ws.send("Connected with protocol");
      },
      message(ws, message) {
        ws.send(`Echo: ${message}`);
      },
    },
  });

  const { stream } = await worker.proxy(
    new Request(url.toString(), {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": "echo-protocol",
      },
    })
  );

  expect(negotiatedProtocol).toBe("echo-protocol");
  expect(stream).toBeGreaterThan(0);
});

test("proxy multiple headers with same name", async () => {
  const { worker } = createWorkerServer();
  const receivedHeaders: Record<string, string> = {};

  const { url } = Bun.serve({
    port: 0,
    fetch: (request) => {
      request.headers.forEach((value, key) => {
        receivedHeaders[key] = value;
      });
      return new Response("OK", {
        headers: {
          "Set-Cookie": "session=abc123",
          "X-Custom": "value1",
        },
      });
    },
  });

  const response = await worker.proxy(
    new Request(url, {
      headers: {
        "X-Custom": "test",
        Authorization: "Bearer token123",
      },
    })
  );

  expect(response.headers.get("Set-Cookie")).toBe("session=abc123");
  expect(response.headers.get("X-Custom")).toBe("value1");
  expect(receivedHeaders["authorization"]).toBe("Bearer token123");
  expect(receivedHeaders["x-custom"]).toBe("test");
});

test("proxy streaming response", async () => {
  const { worker } = createWorkerServer();
  let continueResponse!: () => void;
  const continuePromise = new Promise<void>((resolve) => {
    continueResponse = resolve;
  });
  const { url } = Bun.serve({
    port: 0,
    fetch: () => {
      const transform = new TransformStream();
      const writer = transform.writable.getWriter();
      (async () => {
        writer.write(new TextEncoder().encode("Hello "));
        await continuePromise;
        writer.write(new TextEncoder().encode("world!"));
        writer.close();
      })();
      return new Response(transform.readable, {
        status: 202,
        headers: {
          "Magic-Header": "Hello",
        },
      });
    },
  });

  const response = await worker.proxy(
    new Request(url, {
      method: "GET",
    })
  );
  expect(response.status).toBe(202);
  expect(response.headers.get("Magic-Header")).toBe("Hello");
  const stream = new TextDecoderStream();
  response.body?.pipeTo(stream.writable as any);
  const reader = stream.readable.getReader();
  let chunk = await reader.read();
  expect(chunk.value!.toString()).toBe("Hello ");
  continueResponse();
  chunk = await reader.read();
  expect(chunk.value!.toString()).toBe("world!");
  chunk = await reader.read();
  expect(chunk.done).toBe(true);
});

test("proxy websocket", async () => {
  const { worker } = createWorkerServer();

  let resolveClose: (value: { code: number; reason: string }) => void;
  const closePromise = new Promise<{ code: number; reason: string }>((r) => {
    resolveClose = r;
  });

  const { url } = Bun.serve({
    port: 0,
    fetch: (req, server) => {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        ws.send("Hello!");
      },
      message(ws, message) {
        ws.send(message);
      },
      close(ws, code, reason) {
        resolveClose({ code, reason });
      },
    },
  });

  const { stream } = await worker.proxy(
    new Request(url.toString(), {
      method: "GET",
      headers: {
        Upgrade: "websocket",
      },
    })
  );
  const awaitMessage = () => {
    return new Promise<string>((r) => {
      const dispose = worker.onWebSocketMessage(({ stream, message }) => {
        r(message.toString());
        dispose.dispose();
      });
    });
  };
  let msg = await awaitMessage();
  worker.sendProxiedWebSocketMessage(stream, "Test");
  msg = await awaitMessage();
  expect(msg).toBe("Test");
  worker.sendProxiedWebSocketClose(stream);
  const { code, reason } = await closePromise;
  expect(code).toBe(1000);
  expect(reason).toBe("");
});

test("proxy websocket with binary data", async () => {
  const { worker } = createWorkerServer();

  let resolveClose: (value: { code: number; reason: string }) => void;
  const closePromise = new Promise<{ code: number; reason: string }>((r) => {
    resolveClose = r;
  });

  const { url } = Bun.serve({
    port: 0,
    fetch: (req, server) => {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        // Send binary data on open
        const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes
        ws.send(binaryData);
      },
      message(ws, message) {
        // Echo back the received message (binary or text)
        ws.send(message);
      },
      close(ws, code, reason) {
        resolveClose({ code, reason });
      },
    },
  });

  const { stream } = await worker.proxy(
    new Request(url.toString(), {
      method: "GET",
      headers: {
        Upgrade: "websocket",
      },
    })
  );

  const awaitMessage = () => {
    return new Promise<Uint8Array | string>((r) => {
      const dispose = worker.onWebSocketMessage(({ stream, message }) => {
        r(message);
        dispose.dispose();
      });
    });
  };

  // Receive the initial binary message
  let msg = await awaitMessage();
  expect(msg).toBeInstanceOf(Uint8Array);
  const initialBinary = msg as Uint8Array;
  expect(Array.from(initialBinary)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

  // Send binary data and expect it back
  const testBinaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff]);
  worker.sendProxiedWebSocketMessage(stream, testBinaryData);
  msg = await awaitMessage();
  expect(msg).toBeInstanceOf(Uint8Array);
  const echoBinary = msg as Uint8Array;
  expect(Array.from(echoBinary)).toEqual([0x01, 0x02, 0x03, 0x04, 0xff]);

  // Send text data and expect it back (mixed test)
  worker.sendProxiedWebSocketMessage(stream, "Test text");
  msg = await awaitMessage();
  expect(typeof msg).toBe("string");
  expect(msg).toBe("Test text");

  worker.sendProxiedWebSocketClose(stream);
  const { code, reason } = await closePromise;
  expect(code).toBe(1000);
  expect(reason).toBe("");
});

test("proxy large concurrent responses", async () => {
  const { worker } = createWorkerServer();

  const MB = 1024 * 1024;
  const RESPONSE_SIZE = 5 * MB;
  const CONCURRENT_REQUESTS = 5;

  const { url } = Bun.serve({
    port: 0,
    fetch: (request) => {
      const requestId = new URL(request.url).searchParams.get("id") || "1";

      const data = new Uint8Array(RESPONSE_SIZE);
      const baseValue = parseInt(requestId) * 100;
      for (let i = 0; i < RESPONSE_SIZE; i++) {
        data[i] = (baseValue + i) % 256;
      }

      return new Response(data, {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Request-Id": requestId,
        },
      });
    },
  });

  const startTime = Date.now();

  // Use Promise.all exactly like the original test
  const requests = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    worker.proxy(new Request(`${url}?id=${i + 1}`))
  );

  const responses = await Promise.all(requests);

  // Read all response bodies
  const bodyPromises = responses.map(async (response, i) => {
    if (!response.body) {
      throw new Error(`Response ${i + 1} has no body`);
    }

    const reader = response.body.getReader();
    let totalReceived = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) totalReceived += value.length;
      }
    } finally {
      reader.releaseLock();
    }

    return totalReceived;
  });

  const receivedSizes = await Promise.all(bodyPromises);

  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const totalData = receivedSizes.reduce((a, b) => a + b, 0);
  const aggregateThroughput = totalData / MB / (totalTime / 1000);

  // Verify all data received correctly
  receivedSizes.forEach((size, i) => {
    expect(size).toBe(RESPONSE_SIZE);
  });

  expect(aggregateThroughput).toBeGreaterThan(2.0);
});

const createWorkerServer = () => {
  const server = new Server({
    send: (message) => {
      // Add some delay so things aren't processing in the same tick.
      // Otherwise, this doesn't allow our listeners to register properly.
      setTimeout(() => {
        worker.handleServerMessage(message);
      }, 1);
    },
  });
  const worker = new Worker({
    sendToServer: (message) => {
      server.handleMessage(message);
    },
    sendToClient: (streamID, message) => {
      // Noop - none of our tests engage with clients.
    },
  });
  return { server, worker };
};
