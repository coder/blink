import { DurableObject } from "cloudflare:workers";
import { Worker } from "@blink.so/compute-protocol-worker";
import type { ConnectionEstablished } from "../schema";
import { TUNNEL_COOKIE_HEADER } from "../schema";

type WebsocketState =
  | {
      type: "client";
    }
  | {
      type: "proxied";
      streamID: number;
    };

interface WebSocket extends globalThis.WebSocket {
  deserializeAttachment(): WebsocketState;
  serializeAttachment(state: WebsocketState): void;
}

export interface TunnelSessionEnv {
  TUNNEL_SECRET: string;
  TUNNEL_BASE_URL: string;
  TUNNEL_MODE: "wildcard" | "subpath";
}

/**
 * Durable Object that manages a single tunnel session.
 *
 * State that survives restarts:
 * - id: The tunnel ID (generated from client secret)
 * - nextStreamID: For multiplexer continuity
 */
export class TunnelSession extends DurableObject<TunnelSessionEnv> {
  private id?: string;
  private nextStreamID?: number;
  private cachedWorker?: Worker;

  constructor(state: DurableObjectState, env: TunnelSessionEnv) {
    super(state, env);

    // Restore persisted state
    this.ctx.blockConcurrencyWhile(async () => {
      this.id = await this.ctx.storage.get("id");
      this.nextStreamID = await this.ctx.storage.get("nextStreamID");
    });
  }

  /**
   * Check if a client is currently connected.
   */
  public isConnected(): boolean {
    return this.ctx.getWebSockets("client").length > 0;
  }

  /**
   * Handle incoming requests.
   */
  public override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Proxy request (check BEFORE WebSocket upgrade since proxied WS also has upgrade header)
    if (
      url.pathname === "/proxy" ||
      request.headers.has("x-tunnel-proxy-url")
    ) {
      return this.handleProxyRequest(request);
    }

    // Client connecting via WebSocket
    if (request.headers.get("upgrade") === "websocket") {
      // Initialize session from the headers if needed
      const tunnelId = request.headers.get("x-tunnel-id");

      if (tunnelId && !this.id) {
        this.id = tunnelId;
        await this.ctx.storage.put("id", tunnelId);
      }

      return this.handleClientConnect(request);
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Handle a client connecting via WebSocket.
   */
  private async handleClientConnect(_request: Request): Promise<Response> {
    // Close any existing client connections
    const existingClients = this.ctx.getWebSockets("client");
    for (const ws of existingClients) {
      ws.close(1000, "A new client has connected.");
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.serializeAttachment({ type: "client" });
    this.ctx.acceptWebSocket(server, ["client"]);

    // Send connection established message with the public URL
    const publicUrl = this.getPublicUrl();
    if (!this.id) {
      return new Response("Tunnel ID not initialized", { status: 500 });
    }
    const connectionInfo: ConnectionEstablished = {
      url: publicUrl,
      id: this.id,
    };

    // Queue the message to be sent after the connection is established
    this.ctx.waitUntil(
      (async () => {
        // Check if WebSocket is still open before sending (1 = OPEN)
        if (server.readyState === 1) {
          server.send(JSON.stringify(connectionInfo));
        }
      })()
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle a proxy request from the edge.
   */
  private async handleProxyRequest(request: Request): Promise<Response> {
    if (!this.isConnected()) {
      return new Response(
        JSON.stringify({
          error: "No client connected",
          message:
            "The tunnel client is not currently connected. Please ensure your local server is running.",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const proxyUrl = request.headers.get("x-tunnel-proxy-url") ?? request.url;
    const headers = new Headers(request.headers);
    headers.delete("x-tunnel-proxy-url");

    const worker = this.getWorker();

    try {
      const response = await worker.proxy(
        new Request(proxyUrl, {
          headers,
          method: request.method,
          body: request.body,
          signal: request.signal,
          redirect: "manual",
        })
      );

      // Handle WebSocket upgrade
      if (response.upgrade) {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        server.serializeAttachment({
          type: "proxied",
          streamID: response.stream,
        });
        this.ctx.acceptWebSocket(server, [
          "proxied",
          response.stream.toString(),
        ]);

        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }

      const responseHeaders = new Headers(response.headers);
      const tunnelCookies = parseTunnelCookies(responseHeaders);
      responseHeaders.delete(TUNNEL_COOKIE_HEADER);
      for (const cookie of tunnelCookies) {
        responseHeaders.append("Set-Cookie", cookie);
      }

      // Handle null body status codes
      if ([101, 204, 205, 304].includes(response.status)) {
        return new Response(null, {
          status: response.status,
          headers: responseHeaders,
          statusText: response.statusText,
        });
      }

      return new Response(response.body ?? null, {
        status: response.status,
        headers: responseHeaders,
        statusText: response.statusText,
      });
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: needed for debugging
      console.error("Proxy error", err);
      return new Response(
        JSON.stringify({
          error: "Proxy error",
          message: "Internal server error",
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        }
      );
    }
  }

  /**
   * Handle WebSocket messages.
   */
  public override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const state = ws.deserializeAttachment();
    const worker = this.getWorker();

    switch (state.type) {
      case "client": {
        let bytes: Uint8Array;
        if (typeof message === "string") {
          // Node.js ws library may send binary as string in some workerd/miniflare environments
          // Convert string to binary assuming Latin-1 encoding (each char is one byte)
          bytes = new Uint8Array(message.length);
          for (let i = 0; i < message.length; i++) {
            bytes[i] = message.charCodeAt(i);
          }
        } else {
          bytes = new Uint8Array(message);
        }
        worker.handleServerMessage(bytes);
        break;
      }
      case "proxied": {
        // Forward WebSocket message to client
        worker.sendProxiedWebSocketMessage(state.streamID, message);
        break;
      }
    }
  }

  /**
   * Handle WebSocket close.
   */
  public override async webSocketClose(
    ws: WebSocket,
    code: number
  ): Promise<void> {
    const state = ws.deserializeAttachment();

    switch (state.type) {
      case "client": {
        // Client disconnected, close all proxied WebSockets
        const proxied = this.ctx.getWebSockets("proxied");
        for (const proxyWs of proxied) {
          try {
            proxyWs.close(code, "Client disconnected");
          } catch {
            // Ignore errors
          }
        }
        // Reciprocate the close to complete the WebSocket close handshake
        // https://github.com/cloudflare/workerd/issues/4327#issuecomment-3670433485
        try {
          ws.close(code, "Closed");
        } catch {
          // Already closed
        }
        break;
      }
      case "proxied": {
        const worker = this.getWorker();
        worker.sendProxiedWebSocketClose(state.streamID, code);
        // Close the server side of the WebSocketPair to complete the handshake
        try {
          ws.close(code, "Closed");
        } catch {
          // Already closed
        }
        break;
      }
    }
  }

  /**
   * Handle WebSocket errors.
   */
  public override async webSocketError(
    ws: WebSocket,
    error: unknown
  ): Promise<void> {
    const state = ws.deserializeAttachment();
    // biome-ignore lint/suspicious/noConsole: useful for debugging
    console.error("WebSocket error", state, error);
  }

  /**
   * Get or create the Worker instance.
   */
  private getWorker(): Worker {
    if (!this.cachedWorker) {
      this.cachedWorker = new Worker({
        initialNextStreamID: this.nextStreamID,
        sendToServer: (data: Uint8Array) => {
          const clients = this.ctx.getWebSockets("client");
          for (const client of clients) {
            try {
              client.send(data);
            } catch {
              // Ignore send errors
            }
          }
        },
        sendToClient: (_streamID: number, _message: string) => {},
      });

      // Persist stream ID changes
      this.cachedWorker.onNextStreamIDChange((streamID: number) => {
        this.nextStreamID = streamID;
        this.ctx.waitUntil(this.ctx.storage.put("nextStreamID", streamID));
      });

      // Handle WebSocket messages from the client
      this.cachedWorker.onWebSocketMessage((event) => {
        const [socket] = this.ctx.getWebSockets(event.stream.toString());
        if (socket) {
          socket.send(event.message);
        }
      });

      // Handle WebSocket close from the client
      this.cachedWorker.onWebSocketClose((event) => {
        const [socket] = this.ctx.getWebSockets(event.stream.toString());
        if (socket) {
          socket.close(event.code, event.reason);
        }
      });
    }
    return this.cachedWorker;
  }

  /**
   * Get the public URL for this tunnel.
   */
  private getPublicUrl(): string {
    const baseUrl = this.env.TUNNEL_BASE_URL;
    const mode = this.env.TUNNEL_MODE || "wildcard";

    if (mode === "subpath") {
      return `${baseUrl}/tunnel/${this.id}`;
    } else {
      // Wildcard mode: insert ID as subdomain
      const url = new URL(baseUrl);
      url.hostname = `${this.id}.${url.hostname}`;
      return url.toString().replace(/\/$/, "");
    }
  }
}

function parseTunnelCookies(headers: Headers): string[] {
  const raw = headers.get(TUNNEL_COOKIE_HEADER);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((cookie) => typeof cookie === "string");
    }
  } catch {
    // ignore invalid cookie payloads
  }
  return [];
}
