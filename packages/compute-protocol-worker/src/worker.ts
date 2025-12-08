import {
  type AnyNotificationMessage,
  type ClientMessage,
  ClientMessageType,
  createWebSocketMessagePayload,
  parseWebSocketMessagePayload,
  ServerMessageSchema,
  ServerMessageType,
} from "@blink-sdk/compute-protocol/schema";
import { Emitter } from "@blink-sdk/events";
import Multiplexer, { Stream } from "@blink-sdk/multiplexer";

export interface WorkerOptions {
  sendToServer: (message: Uint8Array) => void;
  sendToClient: (streamID: number, message: string) => void;

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

export class Worker {
  private readonly _onNotification = new Emitter<AnyNotificationMessage>();
  public readonly onNotification = this._onNotification.event;
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
  private readonly encoder: TextEncoder = new TextEncoder();
  private readonly decoder: TextDecoder = new TextDecoder();

  public constructor(private readonly opts: WorkerOptions) {
    this.multiplexer = new Multiplexer({
      send: (message: Uint8Array) => {
        opts.sendToServer(message);
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

  // createClientStream creates a new stream for the client.
  public createClientStream(): number {
    const stream = this.multiplexer.createStream();
    this.bindStream(stream);
    return stream.id;
  }

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
      ClientMessageType.PROXY_WEBSOCKET_MESSAGE,
      createWebSocketMessagePayload(message, this.encoder)
    );
  }

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
    stream.writeTyped(
      ClientMessageType.PROXY_WEBSOCKET_CLOSE,
      this.encoder.encode(JSON.stringify({ code, reason }))
    );
    stream.close();
  }

  // proxy performs a request to the server and returns a response.
  // If the status code is 101, the response is a WebSocket.
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
    request.signal.addEventListener(
      "abort",
      () => {
        rejectResponse(request.signal.reason);
      },
      { once: true }
    );

    const body = new TransformStream();
    const writer = body.writable.getWriter();
    let writeQueue: Promise<void> = Promise.resolve();

    stream.onData((message: Uint8Array) => {
      const payload = message.subarray(1);
      switch (message[0]) {
        case ServerMessageType.PROXY_INIT: {
          const parsed = ServerMessageSchema[
            ServerMessageType.PROXY_INIT
          ].safeParse(JSON.parse(this.decoder.decode(payload)));
          if (!parsed.success) {
            throw new Error("Invalid proxy init message");
          }
          resolveResponse({
            status: parsed.data.status_code,
            headers: new Headers(parsed.data.headers),
            statusText: parsed.data.status_message,
            body: body.readable,
            stream: stream.id,
            upgrade: parsed.data.status_code === 101,
          });
          break;
        }
        case ServerMessageType.PROXY_DATA: {
          // Chain writes to avoid interleaving and to respect backpressure.
          writeQueue = writeQueue.then(() => writer.write(payload));
          break;
        }
        case ServerMessageType.PROXY_WEBSOCKET_CLOSE: {
          const parsed = ServerMessageSchema[
            ServerMessageType.PROXY_WEBSOCKET_CLOSE
          ].safeParse(JSON.parse(this.decoder.decode(payload)));
          if (!parsed.success) {
            throw new Error("Invalid proxy websocket close message");
          }
          resolveResponse({
            status: 400,
            headers: new Headers(),
            statusText: parsed.data.reason,
            stream: stream.id,
            upgrade: false,
          });
          break;
        }
      }
    });
    stream.onClose(() => {
      // Ensure all queued writes flush before closing.
      writeQueue.finally(() => writer.close());
    });
    stream.onError((error: string) => {
      rejectResponse(new Error(error));
    });

    const payload: ClientMessage<ClientMessageType.PROXY_INIT> = {
      headers,
      method: request.method,
      url: request.url,
    };

    stream.writeTyped(
      ClientMessageType.PROXY_INIT,
      this.encoder.encode(JSON.stringify(payload)),
      true
    );

    if (request.headers.get("upgrade") === "websocket") {
      // This handles WebSocket messages.
      this.bindStream(stream);
      // No body handling for WebSockets.
      return promise;
    }

    if (request.body) {
      request.body
        .pipeTo(
          new WritableStream({
            async write(chunk) {
              stream.writeTyped(ClientMessageType.PROXY_BODY, chunk);
              await Promise.resolve();
            },
          })
        )
        .then(() => {
          stream.writeTyped(ClientMessageType.PROXY_BODY, new Uint8Array(0));
        });
    } else {
      stream.writeTyped(ClientMessageType.PROXY_BODY, new Uint8Array(0));
    }

    return promise.catch((err) => {
      stream.close();
      throw err;
    });
  }

  // handleServerMessage accepts a message from any server.
  public handleServerMessage(message: Uint8Array): void {
    this.multiplexer.handleMessage(message);
  }

  public handleClientMessage(streamID: number, message: string): void {
    let stream = this.multiplexer.getStream(streamID);
    if (!stream) {
      stream = this.multiplexer.createStream(streamID);
      this.bindStream(stream);
    }
    stream.writeTyped(ClientMessageType.REQUEST, this.encoder.encode(message));
  }

  private bindStream(stream: Stream): void {
    stream.onData((message: Uint8Array) => {
      const payload = message.subarray(1);
      switch (message[0]) {
        case ServerMessageType.NOTIFICATION: {
          this._onNotification.emit(JSON.parse(this.decoder.decode(payload)));
          break;
        }
        case ServerMessageType.RESPONSE: {
          this.opts.sendToClient(stream.id, this.decoder.decode(payload));
          break;
        }
        case ServerMessageType.PROXY_WEBSOCKET_MESSAGE: {
          // We need to handle this.
          this._onWebSocketMessage.emit({
            stream: stream.id,
            message: parseWebSocketMessagePayload(payload, this.decoder),
          });
          break;
        }
        case ServerMessageType.PROXY_WEBSOCKET_CLOSE: {
          const parsed = ServerMessageSchema[
            ServerMessageType.PROXY_WEBSOCKET_CLOSE
          ].safeParse(JSON.parse(this.decoder.decode(payload)));
          if (!parsed.success) {
            throw new Error("Invalid proxy websocket close message");
          }
          this._onWebSocketClose.emit({
            stream: stream.id,
            code: parsed.data.code,
            reason: parsed.data.reason,
          });
          break;
        }
        case ServerMessageType.PROXY_INIT: {
          // We just ignore this.
          break;
        }
        case ServerMessageType.PROXY_DATA: {
          // We just ignore this. It's responding to an invalid request.
          break;
        }
      }
    });
    stream.onClose(() => {
      // TODO: Handle close.
    });
  }
}
