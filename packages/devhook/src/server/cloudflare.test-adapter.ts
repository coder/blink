/**
 * Test adapter for the Cloudflare devhook server using wrangler's unstable_dev.
 *
 * Note: The unstable_dev API can be finicky. This adapter may need adjustments
 * based on the wrangler version and local environment.
 */

import { unstable_dev, type UnstableDevWorker } from "wrangler";
import type { TestServer, TestServerFactory } from "../test-utils";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "../..");

interface CloudflareTestServer extends TestServer {
  worker: UnstableDevWorker;
}

/**
 * Create a Cloudflare Worker server for testing using wrangler's unstable_dev.
 */
export async function createCloudflareTestServer(secret: string): Promise<CloudflareTestServer> {
  // Use a specific port for the worker
  const port = 9787 + Math.floor(Math.random() * 1000);

  // Use the wrangler.toml for proper Durable Object configuration
  const worker = await unstable_dev(
    join(__dirname, "cloudflare.ts"),
    {
      experimental: {
        disableExperimentalWarning: true,
      },
      // Use wrangler.toml for DO bindings but override vars
      config: join(packageRoot, "wrangler.toml"),
      vars: {
        DEVHOOK_SECRET: secret,
        DEVHOOK_BASE_URL: `http://localhost:${port}`,
        DEVHOOK_MODE: "subpath",
      },
      local: true,
      persist: false,
      port,
    }
  );

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
export const createCloudflareServerFactory = (secret: string): TestServerFactory => {
  return async () => createCloudflareTestServer(secret);
};
