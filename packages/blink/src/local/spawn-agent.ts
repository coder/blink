import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "../agent/client";

export interface SpawnAgentOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;

  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export async function spawnAgent(options: SpawnAgentOptions) {
  const port = options.env?.PORT ?? (await getRandomPort());
  const host = options.env?.HOST ?? "127.0.0.1";
  const url = `http://${host}:${port}`;

  const env = {
    ...(options.env ?? process.env),
    PORT: port.toString(),
    HOST: host,
  };

  const proc = spawn(options.command, options.args, {
    stdio: "pipe",
    env,
  });

  options.signal?.addEventListener(
    "abort",
    () => {
      try {
        proc.kill();
      } catch {}
    },
    { once: true }
  );

  // This is for aborting while we're waiting for the health
  // endpoint to be alive.
  const controller = new AbortController();
  const signals = [controller.signal];
  if (options.signal) {
    signals.push(options.signal);
  }
  const signal = AbortSignal.any(signals);

  proc.stdout.on("data", (data) => {
    options.onStdout?.(Buffer.from(data).toString("utf-8"));
  });
  let bufferedStderr = "";
  proc.stderr.on("data", (data) => {
    if (!controller.signal.aborted) {
      bufferedStderr += Buffer.from(data).toString("utf-8");
    }
    options.onStderr?.(Buffer.from(data).toString("utf-8"));
  });
  proc.on("error", (err) => {
    controller.abort(err);
  });
  proc.on("exit", (code, signal) => {
    // Only notify on exit if the startup was already completed.
    if (controller.signal.aborted) {
      options.onExit?.(code, signal);
    } else {
      controller.abort();
    }
  });
  const client = new Client({
    baseUrl: url,
  });
  let attempt = 0;
  // Wait for the health endpoint to be alive.
  while (!signal.aborted) {
    try {
      await client.health();
      break;
    } catch (err) {}
    await new Promise((resolve) => setTimeout(resolve, attempt * 5));
    attempt++;
    if (attempt > 100) {
      throw new Error("Health endpoint timed out");
    }
  }

  if (signal.aborted) {
    throw signal.reason;
  }

  controller.abort();
  return {
    client,
    dispose: () => {
      proc.kill();
    },
  };
}

async function getRandomPort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server
      .listen(0, () => {
        // @ts-expect-error
        const port = server.address().port;
        resolve(port);
      })
      .on("error", (err) => {
        reject(err);
      });
  }).finally(() => {
    server.close();
  });
}
