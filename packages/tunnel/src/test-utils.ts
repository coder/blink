/**
 * Shared test utilities for testing both local and Cloudflare servers.
 *
 * This module provides a common interface for server implementations
 * so the same tests can run against both.
 */

import * as http from "node:http";
import { TunnelClient, type TunnelClientOptions } from "./client";
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
  localTargetPort: number;
  transformRequest?: TunnelClientOptions["transformRequest"];
  onConnect?: TunnelClientOptions["onConnect"];
  onDisconnect?: TunnelClientOptions["onDisconnect"];
  onError?: TunnelClientOptions["onError"];
}

/**
 * Create a TunnelClient configured for testing.
 */
export function createTestClient(opts: TestClientOptions): TunnelClient {
  const { server, secret, localTargetPort, transformRequest, ...rest } = opts;

  return new TunnelClient({
    serverUrl: server.url,
    secret,
    transformRequest:
      transformRequest ??
      (({ method, url, headers }) => {
        url.host = `localhost:${localTargetPort}`;
        return { method, url, headers };
      }),
    ...rest,
  });
}

/**
 * A simple mock HTTP server for testing.
 * Allows defining request handlers dynamically.
 */
export interface MockHttpServer {
  /** The port the server is listening on */
  readonly port: number;
  /** The base URL of the server */
  readonly url: string;
  /** Set the handler for incoming requests */
  setHandler(
    handler: (
      req: http.IncomingMessage,
      res: http.ServerResponse
    ) => void | Promise<void>
  ): void;
  /** Close the server */
  close(): Promise<void>;
}

/**
 * Create a mock HTTP server for testing.
 * Returns a server that can have its handler changed dynamically.
 */
export async function createMockHttpServer(): Promise<MockHttpServer> {
  let handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => void | Promise<void> = (_req, res) => {
    res.writeHead(500);
    res.end("No handler configured");
  };

  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      // biome-ignore lint/suspicious/noConsole: useful for debugging
      console.error("Mock server handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Handler error");
      }
    });
  });

  // Listen on random available port
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number };

  return {
    get port() {
      return address.port;
    },
    get url() {
      return `http://127.0.0.1:${address.port}`;
    },
    setHandler(h) {
      handler = h;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/**
 * Helper to read the full body from an IncomingMessage.
 */
export async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Helper to read the full body as JSON from an IncomingMessage.
 */
export async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return JSON.parse(body);
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
export function closeWsServer(server: {
  clients: Set<{ terminate: () => void }>;
  close: () => void;
}): void {
  for (const client of server.clients) {
    client.terminate();
  }
  server.close();
}

export const newPromise = <T = void>(): {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  promise: Promise<T>;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const p = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { resolve, reject, promise: p };
};
