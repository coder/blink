/**
 * Shared test utilities for testing both local and Cloudflare servers.
 *
 * This module provides a common interface for server implementations
 * so the same tests can run against both.
 */

import {
  TunnelClient,
  type TunnelClientOptions,
  type WebSocketRequest,
} from "./client";
import { generateTunnelId } from "./server/crypto";

/**
 * Common interface for tunnel server implementations.
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
  onRequest?: TunnelClientOptions["onRequest"];
  onConnect?: TunnelClientOptions["onConnect"];
  onDisconnect?: TunnelClientOptions["onDisconnect"];
  onError?: TunnelClientOptions["onError"];
}

/**
 * Create a TunnelClient configured for testing.
 */
export function createTestClient(opts: TestClientOptions): TunnelClient {
  const {
    server,
    secret,
    localTargetPort,
    transformWebSocketRequest,
    onRequest,
    ...rest
  } = opts;

  return new TunnelClient({
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
 * Helper to generate a tunnel ID for testing.
 */
export async function getTunnelId(
  clientSecret: string,
  serverSecret: string
): Promise<string> {
  return generateTunnelId(clientSecret, serverSecret);
}

/**
 * Helper to build the tunnel URL for a given ID.
 */
export function getTunnelUrl(
  server: TestServer,
  tunnelId: string,
  path = ""
): string {
  return `${server.url}/tunnel/${tunnelId}${path}`;
}

/**
 * Helper to build the WebSocket URL for a tunnel.
 */
export function getTunnelWsUrl(
  server: TestServer,
  tunnelId: string,
  path = ""
): string {
  const url = new URL(getTunnelUrl(server, tunnelId, path));
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

/**
 * Close a WebSocketServer and terminate all its clients.
 * This ensures sockets are properly destroyed and don't keep the process alive.
 */
export function closeWsServer(server: { clients: Set<{ terminate: () => void }>; close: () => void }): void {
  for (const client of server.clients) {
    client.terminate();
  }
  server.close();
}
