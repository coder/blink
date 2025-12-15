import Multiplexer, { type Stream } from "@blink-sdk/multiplexer";
import WebSocket from "ws";
import { type Disposable } from "../emitter";
import {
  ClientMessageType,
  ServerMessageType,
  createWebSocketMessagePayload,
  parseWebSocketMessagePayload,
  type ConnectionEstablished,
  type ProxyInitRequest,
  type ProxyInitResponse,
  type WebSocketClosePayload,
} from "../schema";

export interface DevhookClientOptions {
  /**
   * The devhook server URL.
   * For wildcard mode: https://devhook.example.com
   * For subpath mode: https://example.com
   */
  serverUrl: string;

  /**
   * Client secret used to generate a secure, deterministic subdomain.
   * The server signs this with HMAC-SHA256 to create the public URL.
   */
  secret: string;

  /**
   * Handle incoming proxied HTTP requests.
   * Return a Response to send back to the original requester.
   */
  onRequest: (request: Request) => Promise<Response>;

  /**
   * Called when the connection is established.
   * Receives the public URL that can be used to access this devhook.
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
   * Transform the incoming URL to point to the local target.
   * This is used for both HTTP requests (via onRequest) and WebSocket connections.
   * If not provided, URLs are used as-is.
   *
   * @example
   * ```ts
   * transformUrl: (url) => {
   *   url.host = "localhost:3000";
   *   return url;
   * }
   * ```
   */
  transformUrl?: (url: URL) => URL;
}

/**
 * Connect to a devhook server and handle proxied requests.
 *
 * @example
 * ```ts
 * const client = new DevhookClient({
 *   serverUrl: "https://devhook.example.com",
 *   secret: "my-secret-key",
 *   onRequest: async (req) => {
 *     // Forward to local server
 *     const url = new URL(req.url);
 *     url.host = "localhost:3000";
 *     return fetch(new Request(url.toString(), req));
 *   },
 *   onConnect: ({ url }) => {
 *     console.log(`Devhook available at: ${url}`);
 *   },
 * });
 *
 * const disposable = client.connect();
 * // Later: disposable.dispose();
 * ```
 */
export class DevhookClient {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly opts: DevhookClientOptions) {}

  /**
   * Connect to the devhook server.
   * Returns a Disposable that can be used to disconnect.
   */
  connect(): Disposable {
    let socket: WebSocket | undefined;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let multiplexer: Multiplexer | undefined;

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
        wsUrl.pathname = "/api/devhook/connect";

        socket = new WebSocket(wsUrl.toString(), {
          headers: {
            "x-devhook-secret": this.opts.secret,
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
          if (disposed) return;
          multiplexer = undefined;
          this.opts.onDisconnect?.();
          scheduleReconnect();
        });

        socket.on("error", (err) => {
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
        case ServerMessageType.PROXY_INIT: {
          requestInit = JSON.parse(
            this.decoder.decode(payload)
          ) as ProxyInitRequest;
          isWebSocket = requestInit.headers["upgrade"] === "websocket";

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

        case ServerMessageType.PROXY_BODY: {
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

        case ServerMessageType.PROXY_WEBSOCKET_MESSAGE: {
          // WebSocket messages are handled by the WebSocket handler
          break;
        }

        case ServerMessageType.PROXY_WEBSOCKET_CLOSE: {
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
      const hasBody =
        init.method !== "GET" &&
        init.method !== "HEAD" &&
        init.method !== "OPTIONS";

      const request = new Request(init.url, {
        method: init.method,
        headers: init.headers,
        body: hasBody ? body : undefined,
        // @ts-expect-error - Required for Node.js streaming
        duplex: hasBody ? "half" : undefined,
      });

      const response = await this.opts.onRequest(request);

      // Send response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const proxyInit: ProxyInitResponse = {
        status_code: response.status,
        status_message: response.statusText,
        headers,
      };

      stream.writeTyped(
        ClientMessageType.PROXY_INIT,
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
              stream.writeTyped(ClientMessageType.PROXY_DATA, value);
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
        ClientMessageType.PROXY_INIT,
        this.encoder.encode(JSON.stringify(proxyInit)),
        true
      );
      stream.writeTyped(
        ClientMessageType.PROXY_DATA,
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
      // Transform the URL using the same pattern as onRequest
      // This allows the user to map the devhook URL to the local target
      let targetUrl = new URL(init.url);

      if (this.opts.transformUrl) {
        targetUrl = this.opts.transformUrl(targetUrl);
      }

      targetUrl.protocol = targetUrl.protocol === "https:" ? "wss:" : "ws:";

      const ws = new WebSocket(targetUrl.toString(), init.headers["sec-websocket-protocol"], {
        headers: init.headers,
        perMessageDeflate: false,
      });

      ws.on("open", () => {
        const proxyInit: ProxyInitResponse = {
          status_code: 101,
          status_message: "Switching Protocols",
          headers: {},
        };
        stream.writeTyped(
          ClientMessageType.PROXY_INIT,
          this.encoder.encode(JSON.stringify(proxyInit)),
          true
        );
      });

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        const payload =
          data instanceof ArrayBuffer
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : data;
        stream.writeTyped(
          ClientMessageType.PROXY_WEBSOCKET_MESSAGE,
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
            ClientMessageType.PROXY_WEBSOCKET_CLOSE,
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
            ClientMessageType.PROXY_WEBSOCKET_CLOSE,
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
          case ServerMessageType.PROXY_WEBSOCKET_MESSAGE: {
            const parsed = parseWebSocketMessagePayload(payload, this.decoder);
            ws.send(parsed);
            break;
          }
          case ServerMessageType.PROXY_WEBSOCKET_CLOSE: {
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
              // Ignore close errors
              ws.close();
            }
            break;
          }
        }
      });

      stream.onClose(() => {
        ws.close();
      });
    } catch (err) {
      const proxyInit: ProxyInitResponse = {
        status_code: 502,
        status_message: "Bad Gateway",
        headers: {},
      };
      stream.writeTyped(
        ClientMessageType.PROXY_INIT,
        this.encoder.encode(JSON.stringify(proxyInit)),
        true
      );
      stream.close();
    }
  }
}
