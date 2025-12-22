import { Emitter } from "@blink-sdk/events";
import Multiplexer, { type Stream } from "@blink-sdk/multiplexer";
import {
  ClientMessageType,
  createWebSocketMessagePayload,
  type ProxyInitRequest,
  type ProxyInitResponse,
  parseWebSocketMessagePayload,
  ServerMessageType,
  type WebSocketClosePayload,
} from "../schema";

export interface WorkerOptions {
  sendToClient: (message: Uint8Array) => void;
  initialNextStreamID?: number;
}

export interface ProxyResponse {
  stream: number;
  status: number;
  headers: Headers;
  statusText: string;
  upgrade: boolean;
  body?: ReadableStream<Uint8Array>;
}

/**
 * Worker handles the server-side of the tunnel protocol.
 * It multiplexes proxy requests to the connected client.
 */
export class Worker {
  private readonly _onWebSocketMessage = new Emitter<{
    stream: number;
    message: Uint8Array | string;
  }>();
  public readonly onWebSocketMessage = this._onWebSocketMessage.event;

  private readonly _onWebSocketClose = new Emitter<{
    stream: number;
    code: number;
    reason: string;
  }>();
  public readonly onWebSocketClose = this._onWebSocketClose.event;

  private readonly multiplexer: Multiplexer;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(readonly opts: WorkerOptions) {
    this.multiplexer = new Multiplexer({
      send: (message: Uint8Array) => {
        opts.sendToClient(message);
      },
      isClient: true,
      initialNextStreamID: opts.initialNextStreamID,
    });
    this.multiplexer.onStream((stream: Stream) => {
      this.bindStream(stream);
    });
  }

  public get onNextStreamIDChange() {
    return this.multiplexer.onNextStreamIDChange;
  }

  /**
   * Proxy an HTTP request to the connected client.
   */
  public proxy(request: Request): Promise<ProxyResponse> {
    const stream = this.multiplexer.createStream();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let resolveResponse: (response: ProxyResponse) => void;
    let rejectResponse: (error: Error) => void;
    const promise = new Promise<ProxyResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    request.signal?.addEventListener(
      "abort",
      () => {
        rejectResponse(request.signal.reason);
      },
      { once: true }
    );

    const body = new TransformStream<Uint8Array, Uint8Array>();
    const writer = body.writable.getWriter();
    let writeQueue: Promise<void> = Promise.resolve();

    stream.onData((message: Uint8Array) => {
      const type = message[0];
      const payload = message.subarray(1);

      switch (type) {
        case ClientMessageType.PROXY_INIT: {
          const parsed = JSON.parse(
            this.decoder.decode(payload)
          ) as ProxyInitResponse;

          const headers = new Headers(parsed.headers);

          // Restore multiple Set-Cookie headers
          if (parsed.set_cookies) {
            for (const cookie of parsed.set_cookies) {
              headers.append("Set-Cookie", cookie);
            }
          }

          resolveResponse({
            status: parsed.status_code,
            headers,
            statusText: parsed.status_message,
            body: body.readable,
            stream: stream.id,
            upgrade: parsed.status_code === 101,
          });
          break;
        }
        case ClientMessageType.PROXY_DATA: {
          writeQueue = writeQueue.then(() => writer.write(payload));
          break;
        }
        // Note: PROXY_WEBSOCKET_MESSAGE and PROXY_WEBSOCKET_CLOSE are handled
        // by bindStream() which is called for WebSocket upgrades. We don't
        // handle them here to avoid duplicate event emissions.
      }
    });

    stream.onClose(() => {
      writeQueue.finally(() => writer.close().catch(() => {}));
    });

    stream.onError((error: string) => {
      rejectResponse(new Error(error));
    });

    // Send the proxy request to the client
    const proxyInit: ProxyInitRequest = {
      headers,
      method: request.method,
      url: request.url,
    };

    stream.writeTyped(
      ServerMessageType.PROXY_INIT,
      this.encoder.encode(JSON.stringify(proxyInit)),
      true
    );

    // Handle WebSocket upgrade
    if (headers.upgrade === "websocket") {
      this.bindStream(stream);
      return promise;
    }

    // Stream request body
    if (request.body) {
      request.body
        .pipeTo(
          new WritableStream({
            write: (chunk) => {
              stream.writeTyped(ServerMessageType.PROXY_BODY, chunk);
            },
          })
        )
        .then(() => {
          stream.writeTyped(ServerMessageType.PROXY_BODY, new Uint8Array(0));
        })
        .catch(() => {
          stream.writeTyped(ServerMessageType.PROXY_BODY, new Uint8Array(0));
        });
    } else {
      stream.writeTyped(ServerMessageType.PROXY_BODY, new Uint8Array(0));
    }

    return promise.catch((err) => {
      stream.close();
      throw err;
    });
  }

  /**
   * Send a WebSocket message to the client.
   */
  public sendProxiedWebSocketMessage(
    streamID: number,
    message: Uint8Array | string | ArrayBuffer
  ) {
    let stream = this.multiplexer.getStream(streamID);
    if (!stream) {
      stream = this.multiplexer.createStream(streamID);
      this.bindStream(stream);
    }
    stream.writeTyped(
      ServerMessageType.PROXY_WEBSOCKET_MESSAGE,
      createWebSocketMessagePayload(message, this.encoder)
    );
  }

  /**
   * Send a WebSocket close to the client.
   */
  public sendProxiedWebSocketClose(
    streamID: number,
    code?: number,
    reason?: string
  ) {
    let stream = this.multiplexer.getStream(streamID);
    if (!stream) {
      stream = this.multiplexer.createStream(streamID);
      this.bindStream(stream);
    }
    const payload: WebSocketClosePayload = { code, reason };
    stream.writeTyped(
      ServerMessageType.PROXY_WEBSOCKET_CLOSE,
      this.encoder.encode(JSON.stringify(payload))
    );
    stream.close();
  }

  /**
   * Handle a message from the connected client.
   */
  public handleClientMessage(message: Uint8Array): void {
    this.multiplexer.handleMessage(message);
  }

  private bindStream(stream: Stream): void {
    stream.onData((message: Uint8Array) => {
      const type = message[0];
      const payload = message.subarray(1);

      switch (type) {
        case ClientMessageType.PROXY_WEBSOCKET_MESSAGE: {
          this._onWebSocketMessage.emit({
            stream: stream.id,
            message: parseWebSocketMessagePayload(payload, this.decoder),
          });
          break;
        }
        case ClientMessageType.PROXY_WEBSOCKET_CLOSE: {
          const closePayload = JSON.parse(
            this.decoder.decode(payload)
          ) as WebSocketClosePayload;
          this._onWebSocketClose.emit({
            stream: stream.id,
            code: closePayload.code ?? 1000,
            reason: closePayload.reason ?? "",
          });
          break;
        }
      }
    });
  }
}
