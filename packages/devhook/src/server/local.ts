/**
 * Local server implementation for testing devhook.
 *
 * This provides the same functionality as the Cloudflare Worker
 * but runs locally using Node.js.
 */

import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Worker } from "./worker";
import { generateDevhookId } from "./crypto";
import type { ConnectionEstablished } from "../schema";

export interface LocalServerOptions {
  /**
   * Port to listen on.
   */
  port: number;

  /**
   * Server secret for HMAC signing.
   */
  secret: string;

  /**
   * Base URL for generating public URLs.
   * In wildcard mode, devhook IDs become subdomains.
   * In subpath mode, devhook IDs become path prefixes.
   */
  baseUrl: string;

  /**
   * Routing mode.
   * - "wildcard": Use subdomains (requires DNS setup)
   * - "subpath": Use path prefixes (easier for local testing)
   */
  mode?: "wildcard" | "subpath";

  /**
   * Called when the server starts.
   */
  onReady?: (port: number) => void;

  /**
   * Called when a client connects.
   */
  onClientConnect?: (id: string) => void;

  /**
   * Called when a client disconnects.
   */
  onClientDisconnect?: (id: string) => void;
}

interface Session {
  id: string;
  clientSecret: string;
  ws: WebSocket | null;
  worker: Worker | null;
  proxiedWebSockets: Map<number, WebSocket>;
}

/**
 * Create a local devhook server for testing.
 *
 * @example
 * ```ts
 * const server = createLocalServer({
 *   port: 8080,
 *   secret: "server-secret",
 *   baseUrl: "http://localhost:8080",
 *   mode: "subpath",
 *   onReady: (port) => console.log(`Server running on port ${port}`),
 * });
 *
 * // Later: server.close();
 * ```
 */
export function createLocalServer(opts: LocalServerOptions): {
  server: HttpServer;
  close: () => void;
} {
  const sessions = new Map<string, Session>();
  const mode = opts.mode || "subpath";

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // Health check
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // WebSocket connection handled separately
    if (url.pathname === "/api/devhook/connect") {
      // WebSocket upgrade is handled by the WebSocketServer
      res.writeHead(426, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "WebSocket required",
          message: "This endpoint requires a WebSocket connection.",
        })
      );
      return;
    }

    // Extract devhook ID
    const devhookId = extractDevhookId(url, opts.baseUrl, mode, req.headers.host);
    if (!devhookId) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not found",
          message: "This endpoint does not exist.",
        })
      );
      return;
    }

    // Find the session
    const session = sessions.get(devhookId);
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "No client connected",
          message:
            "The devhook client is not currently connected. Please ensure your local server is running.",
        })
      );
      return;
    }

    // Build proxy URL
    let proxyPath: string;
    if (mode === "subpath") {
      proxyPath = url.pathname.replace(/^\/devhook\/[a-z0-9]+/, "") || "/";
    } else {
      proxyPath = url.pathname;
    }
    const proxyUrl = new URL(proxyPath + url.search, url.origin);

    // Collect request body
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const body = Buffer.concat(bodyChunks);

    // Build headers
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    }

    try {
      // Create request for the worker
      const proxyRequest = new Request(proxyUrl.toString(), {
        method: req.method || "GET",
        headers,
        body: body.length > 0 ? body : undefined,
      });

      const worker = session.worker!;
      const response = await worker.proxy(proxyRequest);

      // Handle WebSocket upgrade
      if (response.upgrade) {
        // WebSocket upgrade on proxy is complex in Node, skip for now
        res.writeHead(501, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Not implemented",
            message: "WebSocket proxying is not yet supported in local mode.",
          })
        );
        return;
      }

      // Write response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.writeHead(response.status, response.statusText, responseHeaders);

      // Stream response body
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              res.write(Buffer.from(value));
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      res.end();
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Proxy error",
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname !== "/api/devhook/connect") {
      socket.destroy();
      return;
    }

    // Get client secret
    const clientSecret = req.headers["x-devhook-secret"] as string;
    if (!clientSecret) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Generate devhook ID
    const devhookId = await generateDevhookId(clientSecret, opts.secret);

    // Get or create session
    let session = sessions.get(devhookId);
    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
      // Close existing connection
      session.ws.close(1000, "A new client has connected.");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Create worker for this session
      const worker = new Worker({
        initialNextStreamID: session?.worker ? undefined : 1,
        sendToClient: (data: Uint8Array) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        },
      });

      session = {
        id: devhookId,
        clientSecret,
        ws,
        worker,
        proxiedWebSockets: session?.proxiedWebSockets ?? new Map(),
      };
      sessions.set(devhookId, session);

      // Send connection info
      const publicUrl = getPublicUrl(devhookId, opts.baseUrl, mode);
      const connectionInfo: ConnectionEstablished = {
        url: publicUrl,
        id: devhookId,
      };
      ws.send(JSON.stringify(connectionInfo));

      opts.onClientConnect?.(devhookId);

      ws.on("message", (data: Buffer) => {
        worker.handleClientMessage(new Uint8Array(data));
      });

      ws.on("close", () => {
        if (sessions.get(devhookId)?.ws === ws) {
          const s = sessions.get(devhookId)!;
          s.ws = null;
          s.worker = null;
        }
        opts.onClientDisconnect?.(devhookId);
      });

      ws.on("error", () => {
        // Ignore errors
      });
    });
  });

  httpServer.listen(opts.port, () => {
    opts.onReady?.(opts.port);
  });

  return {
    server: httpServer,
    close: () => {
      // Close all WebSocket connections
      for (const session of sessions.values()) {
        session.ws?.close(1000, "Server shutting down");
        for (const ws of session.proxiedWebSockets.values()) {
          ws.close(1000, "Server shutting down");
        }
      }
      sessions.clear();
      wss.close();
      httpServer.close();
    },
  };
}

function extractDevhookId(
  url: URL,
  baseUrl: string,
  mode: "wildcard" | "subpath",
  host?: string
): string | undefined {
  if (mode === "subpath") {
    // Match devhook IDs that are 16 hex characters
    const match = url.pathname.match(/^\/devhook\/([a-f0-9]{16})(\/.*)?$/);
    return match?.[1];
  } else {
    // Wildcard mode
    const baseHost = new URL(baseUrl).hostname;
    if (host && host.endsWith(`.${baseHost}`)) {
      const subdomain = host.slice(0, -(baseHost.length + 1));
      // Remove port if present
      const id = subdomain.split(":")[0];
      if (id && /^[a-f0-9]{16}$/.test(id)) {
        return id;
      }
    }
  }
  return undefined;
}

function getPublicUrl(
  id: string,
  baseUrl: string,
  mode: "wildcard" | "subpath"
): string {
  if (mode === "subpath") {
    return `${baseUrl}/devhook/${id}`;
  } else {
    const url = new URL(baseUrl);
    url.hostname = `${id}.${url.hostname}`;
    return url.toString().replace(/\/$/, "");
  }
}
