import { DurableObject } from "cloudflare:workers";
import { Worker } from "./worker";
import type { ConnectionEstablished } from "../schema";

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

export interface DevhookSessionEnv {
  DEVHOOK_SECRET: string;
  DEVHOOK_BASE_URL: string;
  DEVHOOK_MODE: "wildcard" | "subpath";
}

/**
 * Durable Object that manages a single devhook session.
 *
 * State that survives restarts:
 * - id: The devhook ID (generated from client secret)
 * - nextStreamID: For multiplexer continuity
 * - clientSecret: To verify reconnections
 */
export class DevhookSession extends DurableObject<DevhookSessionEnv> {
  private id?: string;
  private clientSecret?: string;
  private nextStreamID?: number;
  private cachedWorker?: Worker;

  constructor(state: DurableObjectState, env: DevhookSessionEnv) {
    super(state, env);

    // Restore persisted state
    this.ctx.blockConcurrencyWhile(async () => {
      this.id = await this.ctx.storage.get("id");
      this.clientSecret = await this.ctx.storage.get("clientSecret");
      this.nextStreamID = await this.ctx.storage.get("nextStreamID");
    });
  }

  /**
   * Initialize the session with a devhook ID and client secret.
   */
  public async initialize(id: string, clientSecret: string): Promise<void> {
    this.id = id;
    this.clientSecret = clientSecret;
    await this.ctx.storage.put("id", id);
    await this.ctx.storage.put("clientSecret", clientSecret);
  }

  /**
   * Get the stored client secret for verification.
   */
  public getClientSecret(): string | undefined {
    return this.clientSecret;
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

    // Client connecting via WebSocket
    if (request.headers.get("upgrade") === "websocket") {
      return this.handleClientConnect(request);
    }

    // Proxy request
    if (url.pathname === "/proxy" || request.headers.has("x-devhook-proxy-url")) {
      return this.handleProxyRequest(request);
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Handle a client connecting via WebSocket.
   */
  private async handleClientConnect(request: Request): Promise<Response> {
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
    const connectionInfo: ConnectionEstablished = {
      url: publicUrl,
      id: this.id!,
    };

    // Queue the message to be sent after the connection is established
    this.ctx.waitUntil(
      (async () => {
        // Small delay to ensure WebSocket is ready
        await new Promise((resolve) => setTimeout(resolve, 10));
        server.send(JSON.stringify(connectionInfo));
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
            "The devhook client is not currently connected. Please ensure your local server is running.",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const proxyUrl = request.headers.get("x-devhook-proxy-url") ?? request.url;
    const headers = new Headers(request.headers);
    headers.delete("x-devhook-proxy-url");

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
        this.ctx.acceptWebSocket(server, ["proxied", response.stream.toString()]);

        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }

      // Handle null body status codes
      if ([101, 204, 205, 304].includes(response.status)) {
        return new Response(null, {
          status: response.status,
          headers: response.headers,
          statusText: response.statusText,
        });
      }

      return new Response(response.body ?? null, {
        status: response.status,
        headers: response.headers,
        statusText: response.statusText,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Proxy error",
          message: err instanceof Error ? err.message : String(err),
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
        if (typeof message === "string") {
          // Clients should not send string messages
          console.warn("Received unexpected string message from client");
          return;
        }
        worker.handleClientMessage(new Uint8Array(message));
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
  public override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
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
        break;
      }
      case "proxied": {
        const worker = this.getWorker();
        worker.sendProxiedWebSocketClose(state.streamID, code);
        break;
      }
    }
  }

  /**
   * Handle WebSocket errors.
   */
  public override async webSocketError(
    _ws: WebSocket,
    _error: unknown
  ): Promise<void> {
    // Suppress errors to avoid noisy logs
  }

  /**
   * Get or create the Worker instance.
   */
  private getWorker(): Worker {
    if (!this.cachedWorker) {
      this.cachedWorker = new Worker({
        initialNextStreamID: this.nextStreamID,
        sendToClient: (data: Uint8Array) => {
          const clients = this.ctx.getWebSockets("client");
          for (const client of clients) {
            try {
              client.send(data);
            } catch {
              // Ignore send errors
            }
          }
        },
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
   * Get the public URL for this devhook.
   */
  private getPublicUrl(): string {
    const baseUrl = this.env.DEVHOOK_BASE_URL;
    const mode = this.env.DEVHOOK_MODE || "wildcard";

    if (mode === "subpath") {
      return `${baseUrl}/${this.id}`;
    } else {
      // Wildcard mode: insert ID as subdomain
      const url = new URL(baseUrl);
      url.hostname = `${this.id}.${url.hostname}`;
      return url.toString().replace(/\/$/, "");
    }
  }
}
