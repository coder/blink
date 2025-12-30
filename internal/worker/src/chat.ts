import type { StreamChatEvent } from "@blink.so/api";
import { runChat } from "@blink.so/api/util/chat";
import type { DBMessage } from "@blink.so/database/schema";
import { DurableObject } from "cloudflare:workers";
import connectToDatabase from "./database";

// Chat is a Durable Object that is responsible for handling
// the executing of agent runs for a chat.
//
// It's only infrastructure requirement is that it has an
// exclusive lock on the the agent runs for a chat by ID.
export class Chat extends DurableObject<Cloudflare.Env> {
  private id?: string;
  private sseStreams: Set<WritableStreamDefaultWriter<string>> = new Set();
  private streamingBuffer: string[] = [];
  private streamAbortController?: AbortController;

  public constructor(state: DurableObjectState, env: Cloudflare.Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.id = await this.ctx.storage.get("id");
    });
  }

  // We do no authorization here. That's all handled by the server.
  // This incoming request is always streaming responses.
  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket.
    if (request.headers.get("Connection") === "Upgrade") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);

      for (const encoded of this.streamingBuffer) {
        server.send(encoded);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Handle SSE.
    if (request.headers.get("Accept") === "text/event-stream") {
      const transform = new TextEncoderStream();
      const writer = transform.writable.getWriter();
      this.sseStreams.add(writer);
      writer.closed.then(() => {
        this.sseStreams.delete(writer);
      });
      this.ctx.waitUntil(
        (async () => {
          for (const encoded of this.streamingBuffer) {
            await writer.write(encoded);
            // This is super janky but for whatever reason in Cloudflare
            // these do not flush unless we wait for a tick.
            await new Promise((r) => setTimeout(r, 1));
          }
        })()
      );
      return new Response(transform.readable, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          "transfer-encoding": "chunked",
          connection: "keep-alive",
        },
      });
    }

    // Return bad request.
    return new Response("Bad Request", { status: 400 });
  }

  public async start({
    id,
    interrupt,
  }: {
    id: string;
    interrupt: boolean;
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.id !== id) {
        this.id = id;
        await this.ctx.storage.put("id", id);
      }

      if (interrupt) {
        this.streamAbortController?.abort();
      }
    });

    await this.ctx.storage.setAlarm(Date.now());
  }

  // stop is called when the chat is stopped.
  public async stop(): Promise<void> {
    this.streamAbortController?.abort();
  }

  public async broadcastMessagesChanged(
    event: "message.created" | "message.updated",
    messages: DBMessage[]
  ) {
    for (const message of messages) {
      await this.broadcastEvent({
        event,
        data: {
          id: message.id,
          chat_id: message.chat_id,
          role: message.role,
          parts: message.parts,
          format: "ai-sdk",
          created_at: message.created_at.toISOString(),
          metadata: message.metadata,
        },
      });
    }
  }

  public async webSocketMessage(ws: WebSocket, message: ArrayBuffer) {
    // noop - this is just for streaming responses.
  }

  public async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    // we don't care - it's just for streaming responses.
  }

  public async alarm() {
    this.streamAbortController?.abort();
    const controller = new AbortController();
    this.streamAbortController = controller;

    try {
      if (!this.id) {
        throw new Error("Chat ID not set");
      }
      const db = await connectToDatabase(this.env);
      this.streamingBuffer = [];
      const result = await runChat({
        id: this.id,
        signal: controller.signal,
        db,
        broadcast: async (event) => {
          // We only store these because the client needs them on reconnect.
          if (event.event === "message.chunk.added") {
            this.streamingBuffer.push(encodeStreamChatEvent(event));
          }
          this.broadcastEncodedEvent(encodeStreamChatEvent(event));
        },
        waitUntil: this.ctx.waitUntil.bind(this.ctx),
        env: this.env,
        writePlatformLog: (opts) => {
          this.ctx.waitUntil(
            (async () => {
              const { writePlatformLog } = await import("./logs/client");
              await writePlatformLog(this.env, opts);
            })()
          );
        },
      });
      this.streamingBuffer = [];

      if (result.continue) {
        await this.ctx.storage.setAlarm(Date.now());
      }
    } finally {
      if (this.streamAbortController === controller) {
        this.streamAbortController = undefined;
      }
    }
  }

  private async broadcastEvent(event: StreamChatEvent) {
    const encoded = encodeStreamChatEvent(event);
    this.broadcastEncodedEvent(encoded);
  }

  private async broadcastEncodedEvent(encoded: string) {
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(encoded);
    }
    for (const writer of this.sseStreams) {
      // We never await here - we should never block
      // if clients are not reading the data.
      writer.write(encoded).catch((err) => {
        // noop - we don't care.
      });
    }
  }
}

function encodeStreamChatEvent(event: StreamChatEvent): string {
  return [
    // These are SSE events.
    `event: ${event.event}`,
    `data: ${JSON.stringify(event.data)}`,
    "\n",
  ].join("\n");
}
