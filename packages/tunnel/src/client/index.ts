import {
  ClientMessageType,
  createWebSocketMessagePayload,
  parseWebSocketMessagePayload,
  ServerMessageType,
} from "@blink-sdk/compute-protocol/schema";
import type { Disposable } from "@blink-sdk/events";
import Multiplexer, { type Stream } from "@blink-sdk/multiplexer";
import WebSocket from "ws";
import type { ConnectionEstablished } from "../schema";
import { TUNNEL_COOKIE_HEADER } from "../schema";

interface ProxyInitRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
}

interface ProxyInitResponse {
  status_code: number;
  status_message: string;
  headers: Record<string, string>;
}

interface WebSocketClosePayload {
  code?: number;
  reason?: string;
}

const getHeaderValue = (
  headers: Record<string, string>,
  name: string
): string | undefined => {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const stripHopByHopHeaders = (
  headers: Record<string, string>
): Record<string, string> => {
  const connectionTokens = new Set<string>();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "connection") {
      continue;
    }
    for (const token of value.split(",")) {
      const trimmed = token.trim().toLowerCase();
      if (trimmed) {
        connectionTokens.add(trimmed);
      }
    }
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || connectionTokens.has(lowerKey)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
};

/**
 * Represents an incoming request to be transformed before proxying.
 */
export interface TransformRequest {
  /** The HTTP method (GET, POST, etc.) */
  method: string;
  /** The incoming request URL */
  url: URL;
  /** The incoming request headers */
  headers: Record<string, string>;
}

/**
 * The result of transforming a request.
 */
export interface TransformResult {
  /** The HTTP method to use (ignored for WebSocket) */
  method: string;
  /** The target URL to proxy to */
  url: URL;
  /** The headers to send with the proxied request */
  headers: Record<string, string>;
}

export interface TunnelClientOptions {
  /**
   * The tunnel server URL.
   * For wildcard mode: https://tunnel.example.com
   * For subpath mode: https://example.com
   */
  serverUrl: string;

  /**
   * Client secret used to generate a secure, deterministic subdomain.
   * The server signs this with HMAC-SHA256 to create the public URL.
   */
  secret: string;

  /**
   * Transform incoming requests before proxying.
   * This single function handles both HTTP and WebSocket requests.
   * Can be async to allow service discovery or other lookups.
   *
   * @param request - The incoming method, URL, and headers
   * @returns The target method, URL, and headers to proxy to
   *          (method is ignored for WebSocket connections)
   *
   * @example
   * ```ts
   * transformRequest: async ({ method, url, headers }) => {
   *   url.host = "localhost:3000";
   *   return { method, url, headers };
   * }
   * ```
   */
  transformRequest: (
    request: TransformRequest
  ) => Promise<TransformResult> | TransformResult;

  /**
   * Called when the connection is established.
   * Receives the public URL that can be used to access this tunnel.
   */
  onConnect?: (info: ConnectionEstablished) => void;

  /**
   * Called when the connection is lost.
   */
  onDisconnect?: () => void;

  /**
   * Called when an error occurs.
   */
  onError?: (error: unknown) => void;

  /**
   * Interval in milliseconds between ping messages sent to detect dead connections.
   * Set to 0 to disable ping/pong keepalive.
   * @default 30000 (30 seconds)
   */
  pingIntervalMs?: number;

  /**
   * Timeout in milliseconds to wait for a pong response before considering the connection dead.
   * If no pong is received within this time after a ping, the connection will be terminated
   * and reconnection will be attempted.
   * @default 10000 (10 seconds)
   */
  pongTimeoutMs?: number;
}

/**
 * Connect to a tunnel server and handle proxied requests.
 *
 * @example
 * ```ts
 * const client = new TunnelClient({
 *   serverUrl: "https://tunnel.example.com",
 *   secret: "my-secret-key",
 *   transformRequest: async ({ method, url, headers }) => {
 *     url.host = "localhost:3000";
 *     return { method, url, headers };
 *   },
 *   onConnect: ({ url }) => {
 *     console.log(`Tunnel available at: ${url}`);
 *   },
 * });
 *
 * const disposable = client.connect();
 * // Later: disposable.dispose();
 * ```
 */
export class TunnelClient {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly opts: TunnelClientOptions) {}

  /**
   * Connect to the tunnel server.
   * Returns a Disposable that can be used to disconnect.
   */
  connect(): Disposable {
    let socket: WebSocket | undefined;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let multiplexer: Multiplexer | undefined;

    // Ping/pong keepalive to detect dead connections
    const pingIntervalMs = this.opts.pingIntervalMs ?? 30_000;
    const pongTimeoutMs = this.opts.pongTimeoutMs ?? 10_000;
    let pingInterval: ReturnType<typeof setInterval> | undefined;
    let pongTimeout: ReturnType<typeof setTimeout> | undefined;

    // Exponential backoff with jitter
    const baseDelayMS = 250;
    const maxDelayMS = 10_000;
    let currentDelayMS = baseDelayMS;

    const clearReconnectTimer = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }
    };

    const clearPingPong = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = undefined;
      }
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = undefined;
      }
    };

    const startPingPong = () => {
      // Skip if ping/pong is disabled
      if (pingIntervalMs <= 0) return;

      clearPingPong();
      pingInterval = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.ping();
          // Set timeout for pong response
          pongTimeout = setTimeout(() => {
            // No pong received, connection is dead
            try {
              socket?.terminate();
            } catch {
              // Ignore terminate errors
            }
          }, pongTimeoutMs);
        }
      }, pingIntervalMs);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      clearReconnectTimer();
      const jitter = currentDelayMS * 0.2 * Math.random();
      const delay = Math.min(maxDelayMS, Math.floor(currentDelayMS + jitter));
      reconnectTimeout = setTimeout(() => {
        openSocket();
      }, delay);
      currentDelayMS = Math.min(maxDelayMS, Math.floor(currentDelayMS * 1.5));
    };

    const resetBackoff = () => {
      currentDelayMS = baseDelayMS;
    };

    const openSocket = () => {
      if (disposed) return;

      try {
        const wsUrl = new URL(this.opts.serverUrl);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
        wsUrl.pathname = "/api/tunnel/connect";

        socket = new WebSocket(wsUrl.toString(), {
          headers: {
            "x-tunnel-secret": this.opts.secret,
          },
        });
        socket.binaryType = "arraybuffer";

        multiplexer = new Multiplexer({
          send: (data: Uint8Array) => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(data);
            }
          },
        });

        multiplexer.onStream((stream: Stream) => {
          this.handleStream(stream);
        });

        socket.on("open", () => {
          if (disposed) return;
          resetBackoff();
          startPingPong();
        });

        socket.on("pong", () => {
          // Pong received, connection is alive - clear the timeout
          if (pongTimeout) {
            clearTimeout(pongTimeout);
            pongTimeout = undefined;
          }
        });

        socket.on("message", (data: ArrayBuffer | Buffer) => {
          if (disposed) return;

          const bytes =
            data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

          // Check if this is a connection established message (JSON)
          // Connection messages are sent as text, not binary multiplexed data
          if (bytes.length > 0 && bytes[0] === 0x7b) {
            // '{' character
            try {
              const text = this.decoder.decode(bytes);
              const msg = JSON.parse(text) as ConnectionEstablished;
              if (msg.url && msg.id) {
                this.opts.onConnect?.(msg);
                return;
              }
            } catch {
              // Not JSON, continue with binary handling
            }
          }

          multiplexer?.handleMessage(bytes);
        });

        socket.on("close", () => {
          clearPingPong();
          this.opts.onDisconnect?.();
          if (disposed) return;
          multiplexer = undefined;
          scheduleReconnect();
        });

        socket.on("error", (err) => {
          clearPingPong();
          try {
            this.opts.onError?.(err);
          } catch {
            // Ignore errors from error handler
          }
          try {
            socket?.close();
          } catch {
            // Ignore close errors
          }
        });
      } catch (err) {
        try {
          this.opts.onError?.(err);
        } catch {
          // Ignore errors from error handler
        }
        scheduleReconnect();
      }
    };

    openSocket();

    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        clearReconnectTimer();
        clearPingPong();
        const ws = socket;
        socket = undefined;
        multiplexer = undefined;
        try {
          if (
            ws &&
            (ws.readyState === WebSocket.OPEN ||
              ws.readyState === WebSocket.CONNECTING)
          ) {
            ws.close(1000);
          }
        } catch {
          // Ignore close errors
        }
      },
    };
  }

  /**
   * Handle a new stream from the multiplexer.
   * Each stream represents a single proxied request.
   */
  private handleStream(stream: Stream): void {
    let requestInit: ProxyInitRequest | undefined;
    let bodyWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let bodyStream: ReadableStream<Uint8Array> | undefined;
    let isWebSocket = false;

    stream.onData((message: Uint8Array) => {
      const type = message[0];
      const payload = message.subarray(1);

      switch (type) {
        case ClientMessageType.PROXY_INIT: {
          requestInit = JSON.parse(
            this.decoder.decode(payload)
          ) as ProxyInitRequest;
          const upgradeHeader = getHeaderValue(requestInit.headers, "upgrade");
          isWebSocket = upgradeHeader?.toLowerCase() === "websocket";

          if (!isWebSocket) {
            // Set up body stream for non-WebSocket requests
            const transform = new TransformStream<Uint8Array, Uint8Array>();
            bodyWriter = transform.writable.getWriter();
            bodyStream = transform.readable;

            // Process the request
            this.handleProxyRequest(stream, requestInit, bodyStream);
          } else {
            // Handle WebSocket upgrade
            this.handleProxyWebSocket(stream, requestInit);
          }
          break;
        }

        case ClientMessageType.PROXY_BODY: {
          if (bodyWriter) {
            if (payload.length === 0) {
              // Empty chunk signals end of body
              bodyWriter.close().catch(() => {});
            } else {
              bodyWriter.write(payload).catch(() => {});
            }
          }
          break;
        }

        case ClientMessageType.PROXY_WEBSOCKET_MESSAGE: {
          // WebSocket messages are handled by the WebSocket handler
          break;
        }

        case ClientMessageType.PROXY_WEBSOCKET_CLOSE: {
          // WebSocket close is handled by the WebSocket handler
          break;
        }
      }
    });
  }

  /**
   * Handle a proxied HTTP request.
   */
  private async handleProxyRequest(
    stream: Stream,
    init: ProxyInitRequest,
    body: ReadableStream<Uint8Array>
  ): Promise<void> {
    try {
      // Transform the request
      const transformed = await this.opts.transformRequest({
        method: init.method,
        url: new URL(init.url),
        headers: { ...init.headers },
      });
      const sanitizedHeaders = stripHopByHopHeaders(transformed.headers);

      // Check if the original request has a body based on its method
      // We use the original method because the body stream exists based on
      // what the original client sent, not what we transform it to
      const hasBody =
        init.method !== "GET" &&
        init.method !== "HEAD" &&
        init.method !== "OPTIONS";

      // Ensure protocol is http/https for fetch
      if (
        transformed.url.protocol !== "http:" &&
        transformed.url.protocol !== "https:"
      ) {
        transformed.url.protocol = "http:";
      }

      const request = new Request(transformed.url.toString(), {
        method: transformed.method,
        headers: sanitizedHeaders,
        body: hasBody ? body : undefined,
        // @ts-expect-error - Required for Node.js streaming
        duplex: hasBody ? "half" : undefined,
      });

      // Don't follow redirects - pass them back to the browser
      // Following redirects can cause TLS errors when the redirect target
      // has different host requirements
      const response = await fetch(request, { redirect: "manual" });

      // Send response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey !== "set-cookie" && lowerKey !== TUNNEL_COOKIE_HEADER) {
          headers[key] = value;
        }
      });

      const setCookies =
        typeof response.headers.getSetCookie === "function"
          ? response.headers.getSetCookie()
          : [];
      if (setCookies.length > 0) {
        headers[TUNNEL_COOKIE_HEADER] = JSON.stringify(setCookies);
      }

      const proxyInit: ProxyInitResponse = {
        status_code: response.status,
        status_message: response.statusText,
        headers,
      };

      stream.writeTyped(
        ServerMessageType.PROXY_INIT,
        this.encoder.encode(JSON.stringify(proxyInit)),
        true
      );

      // Stream response body
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              stream.writeTyped(ServerMessageType.PROXY_DATA, value);
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      stream.close();
    } catch (err) {
      // Send error response
      const proxyInit: ProxyInitResponse = {
        status_code: 502,
        status_message: "Bad Gateway",
        headers: { "content-type": "text/plain" },
      };
      stream.writeTyped(
        ServerMessageType.PROXY_INIT,
        this.encoder.encode(JSON.stringify(proxyInit)),
        true
      );
      stream.writeTyped(
        ServerMessageType.PROXY_DATA,
        this.encoder.encode(
          `Error proxying request: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      stream.close();
    }
  }

  /**
   * Handle a proxied WebSocket connection.
   */
  private async handleProxyWebSocket(
    stream: Stream,
    init: ProxyInitRequest
  ): Promise<void> {
    try {
      // Transform the WebSocket request (URL and headers) before connecting
      // Note: method from result is ignored for WebSocket connections
      const transformed = await this.opts.transformRequest({
        method: init.method,
        url: new URL(init.url),
        headers: { ...init.headers },
      });
      const sanitizedHeaders = stripHopByHopHeaders(transformed.headers);

      // Ensure protocol is ws/wss for WebSocket
      if (
        transformed.url.protocol === "http:" ||
        transformed.url.protocol === "https:"
      ) {
        transformed.url.protocol =
          transformed.url.protocol === "https:" ? "wss:" : "ws:";
      }

      const protocol = getHeaderValue(
        sanitizedHeaders,
        "sec-websocket-protocol"
      );
      const ws = new WebSocket(transformed.url.toString(), protocol, {
        headers: sanitizedHeaders,
        perMessageDeflate: false,
      });

      ws.on("open", () => {
        const proxyInit: ProxyInitResponse = {
          status_code: 101,
          status_message: "Switching Protocols",
          headers: {},
        };
        stream.writeTyped(
          ServerMessageType.PROXY_INIT,
          this.encoder.encode(JSON.stringify(proxyInit)),
          true
        );
      });

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary) => {
        const buffer =
          data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Array.isArray(data)
              ? Buffer.concat(data)
              : data;
        // Convert text messages to string so they're encoded correctly
        const payload = isBinary ? buffer : buffer.toString("utf-8");
        stream.writeTyped(
          ServerMessageType.PROXY_WEBSOCKET_MESSAGE,
          createWebSocketMessagePayload(payload, this.encoder)
        );
      });

      ws.on("close", (code, reason) => {
        try {
          const closePayload: WebSocketClosePayload = {
            code,
            reason: reason.toString(),
          };
          stream.writeTyped(
            ServerMessageType.PROXY_WEBSOCKET_CLOSE,
            this.encoder.encode(JSON.stringify(closePayload))
          );
          stream.close();
        } catch {
          // Stream may already be disposed, ignore
        }
      });

      ws.on("error", (err) => {
        try {
          const closePayload: WebSocketClosePayload = {
            code: 1011,
            reason: err.message,
          };
          stream.writeTyped(
            ServerMessageType.PROXY_WEBSOCKET_CLOSE,
            this.encoder.encode(JSON.stringify(closePayload))
          );
          stream.close();
        } catch {
          // Stream may already be disposed, ignore
        }
      });

      // Handle messages from the server to forward to the local WebSocket
      stream.onData((message: Uint8Array) => {
        const type = message[0];
        const payload = message.subarray(1);

        switch (type) {
          case ClientMessageType.PROXY_WEBSOCKET_MESSAGE: {
            const parsed = parseWebSocketMessagePayload(payload, this.decoder);
            ws.send(parsed);
            break;
          }
          case ClientMessageType.PROXY_WEBSOCKET_CLOSE: {
            try {
              const closePayload = JSON.parse(
                this.decoder.decode(payload)
              ) as WebSocketClosePayload;
              // ws.close requires a valid code (1000 or 3000-4999) or no arguments
              const code = closePayload.code;
              if (code !== undefined && code >= 1000 && code <= 4999) {
                ws.close(code, closePayload.reason);
              } else {
                ws.close();
              }
            } catch {
              ws.close();
            }
            break;
          }
        }
      });

      stream.onClose(() => {
        ws.close();
      });
    } catch (_err) {
      const proxyInit: ProxyInitResponse = {
        status_code: 502,
        status_message: "Bad Gateway",
        headers: {},
      };
      stream.writeTyped(
        ServerMessageType.PROXY_INIT,
        this.encoder.encode(JSON.stringify(proxyInit)),
        true
      );
      stream.close();
    }
  }
}
