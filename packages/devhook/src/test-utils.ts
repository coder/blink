/**
 * Shared test utilities for testing both local and Cloudflare servers.
 *
 * This module provides a common interface for server implementations
 * so the same tests can run against both.
 */

import {
  DevhookClient,
  type DevhookClientOptions,
  type WebSocketRequest,
} from "./client";
import { generateDevhookId } from "./server/crypto";

/**
 * Common interface for devhook server implementations.
 * Both local and Cloudflare servers should implement this.
 */
export interface TestServer {
  /** The base URL of the server (e.g., http://localhost:8080) */
  readonly url: string;

  /** The server secret used for HMAC signing */
  readonly secret: string;

  /** Close/cleanup the server */
  close(): Promise<void> | void;
}

/**
 * Factory function type for creating test servers.
 */
export type TestServerFactory = () => Promise<TestServer>;

/**
 * Options for creating a test client.
 */
export interface TestClientOptions {
  server: TestServer;
  secret: string;
  localTargetPort?: number;
  transformWebSocketRequest?: (request: WebSocketRequest) => WebSocketRequest;
  onRequest?: DevhookClientOptions["onRequest"];
  onConnect?: DevhookClientOptions["onConnect"];
  onDisconnect?: DevhookClientOptions["onDisconnect"];
  onError?: DevhookClientOptions["onError"];
}

/**
 * Create a DevhookClient configured for testing.
 */
export function createTestClient(opts: TestClientOptions): DevhookClient {
  const {
    server,
    secret,
    localTargetPort,
    transformWebSocketRequest,
    onRequest,
    ...rest
  } = opts;

  return new DevhookClient({
    serverUrl: server.url,
    secret,
    transformWebSocketRequest:
      transformWebSocketRequest ??
      (localTargetPort
        ? ({ url, headers }) => {
            url.host = `localhost:${localTargetPort}`;
            return { url, headers };
          }
        : undefined),
    onRequest:
      onRequest ??
      (async (req) => {
        if (localTargetPort) {
          const url = new URL(req.url);
          url.host = `localhost:${localTargetPort}`;
          return fetch(new Request(url.toString(), req));
        }
        return new Response("No handler configured", { status: 500 });
      }),
    ...rest,
  });
}

/**
 * Helper to generate a devhook ID for testing.
 */
export async function getDevhookId(
  clientSecret: string,
  serverSecret: string
): Promise<string> {
  return generateDevhookId(clientSecret, serverSecret);
}

/**
 * Helper to build the devhook URL for a given ID.
 */
export function getDevhookUrl(
  server: TestServer,
  devhookId: string,
  path = ""
): string {
  return `${server.url}/devhook/${devhookId}${path}`;
}

/**
 * Helper to build the WebSocket URL for a devhook.
 */
export function getDevhookWsUrl(
  server: TestServer,
  devhookId: string,
  path = ""
): string {
  const url = new URL(getDevhookUrl(server, devhookId, path));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Wait for a condition with timeout.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Delay helper.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
