/**
 * Test adapter for the Cloudflare tunnel server using wrangler's unstable_dev.
 *
 * Note: The unstable_dev API can be finicky. This adapter may need adjustments
 * based on the wrangler version and local environment.
 */

import * as net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Unstable_DevWorker, unstable_dev } from "wrangler";
import type { TestServer, TestServerFactory } from "../test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "../..");

interface CloudflareTestServer extends TestServer {
  worker: Unstable_DevWorker;
}

const getAvailablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });

const isPortInUseError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: string }).code;
  if (code === "EADDRINUSE") {
    return true;
  }
  const message = (err as { message?: string }).message;
  return (
    typeof message === "string" &&
    (message.includes("EADDRINUSE") ||
      message.includes("address already in use"))
  );
};

const startWorker = async (
  secret: string
): Promise<{ worker: Unstable_DevWorker; port: number }> => {
  const maxAttempts = 10;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = await getAvailablePort();
    try {
      const worker = await unstable_dev(join(__dirname, "cloudflare.ts"), {
        experimental: {
          disableExperimentalWarning: true,
        },
        // Use wrangler.toml for DO bindings but override vars
        config: join(packageRoot, "wrangler.toml"),
        vars: {
          TUNNEL_SECRET: secret,
          TUNNEL_BASE_URL: `http://127.0.0.1:${port}`,
          TUNNEL_MODE: "subpath",
        },
        local: true,
        persist: false,
        port,
      });
      return { worker, port };
    } catch (err) {
      if (isPortInUseError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Failed to start worker after multiple port attempts");
};

/**
 * Create a Cloudflare Worker server for testing using wrangler's unstable_dev.
 */
export async function createCloudflareTestServer(
  secret: string
): Promise<CloudflareTestServer> {
  const { worker, port } = await startWorker(secret);
  const url = `http://127.0.0.1:${port}`;

  // Wait for worker to be ready by polling health endpoint
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        break;
      }
    } catch {
      // Worker not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    url,
    secret,
    worker,
    close: async () => {
      await worker.stop();
    },
  };
}

/**
 * Factory for creating Cloudflare test servers.
 */
export const createCloudflareServerFactory = (
  secret: string
): TestServerFactory => {
  return async () => createCloudflareTestServer(secret);
};
