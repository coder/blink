import type { StreamChatEvent } from "@blink.so/api";
import { runChat, type RunChatOptions } from "@blink.so/api/util/chat";
import type Querier from "@blink.so/database/querier";
import type { DBMessage } from "@blink.so/database/schema";
import type { WebSocketServer } from "ws";
import { WebSocket } from "ws";

type RunChatEnv = RunChatOptions["env"];

class ChatSession {
  private sseStreams: Set<WritableStreamDefaultWriter<string>> = new Set();
  private streamingBuffer: string[] = [];
  private streamAbortController?: AbortController;
  private running = false;

  constructor(private id: string) {}

  addSSEStream(writer: WritableStreamDefaultWriter<string>) {
    this.sseStreams.add(writer);
    writer.closed.then(() => {
      this.sseStreams.delete(writer);
    });

    // Send buffered events to new connection
    (async () => {
      for (const encoded of this.streamingBuffer) {
        await writer.write(encoded);
      }
    })();
  }

  broadcast(
    event: StreamChatEvent,
    wss: WebSocketServer,
    wsDataMap: WeakMap<
      WebSocket,
      { type: "token"; id: string } | { type: "chat"; chatID: string }
    >
  ) {
    const encoded = encodeStreamChatEvent(event);

    // Store message chunks for reconnecting clients
    if (event.event === "message.chunk.added") {
      this.streamingBuffer.push(encoded);
    }

    // Broadcast to WebSockets
    wss.clients.forEach((client) => {
      const data = wsDataMap.get(client);
      if (
        client.readyState === WebSocket.OPEN &&
        data?.type === "chat" &&
        data.chatID === this.id
      ) {
        client.send(encoded);
      }
    });

    // Broadcast to SSE streams
    for (const writer of this.sseStreams) {
      writer.write(encoded).catch(() => {
        // Client disconnected, ignore
      });
    }
  }

  async start(opts: {
    interrupt: boolean;
    db: Querier;
    env: RunChatEnv;
    wss: WebSocketServer;
    wsDataMap: WeakMap<
      WebSocket,
      { type: "token"; id: string } | { type: "chat"; chatID: string }
    >;
  }) {
    if (opts.interrupt) {
      this.streamAbortController?.abort();
    }

    if (this.running && !opts.interrupt) {
      return;
    }

    this.running = true;
    this.executeChat(opts);
  }

  stop() {
    this.streamAbortController?.abort();
    this.running = false;
  }

  private async executeChat(opts: {
    db: Querier;
    env: RunChatEnv;
    wss: WebSocketServer;
    wsDataMap: WeakMap<
      WebSocket,
      { type: "token"; id: string } | { type: "chat"; chatID: string }
    >;
  }) {
    this.streamAbortController?.abort();
    const controller = new AbortController();
    this.streamAbortController = controller;

    try {
      this.streamingBuffer = [];
      const result = await runChat({
        id: this.id,
        signal: controller.signal,
        db: opts.db,
        broadcast: async (event) => {
          this.broadcast(event, opts.wss, opts.wsDataMap);
        },
        waitUntil: async (promise) => {
          // In Node/Bun we can just let it run
          promise.catch(console.error);
        },
        env: opts.env,
        writePlatformLog: async () => {
          // No-op for now
        },
      });

      this.streamingBuffer = [];

      if (result.continue) {
        // Continue executing
        await this.executeChat(opts);
      } else {
        this.running = false;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Expected when stopping
        return;
      }
      console.error("Chat execution error:", error);
      this.running = false;
    } finally {
      if (this.streamAbortController === controller) {
        this.streamAbortController = undefined;
      }
    }
  }

  async broadcastMessagesChanged(
    event: "message.created" | "message.updated",
    messages: DBMessage[],
    wss: WebSocketServer,
    wsDataMap: WeakMap<
      WebSocket,
      { type: "token"; id: string } | { type: "chat"; chatID: string }
    >
  ) {
    for (const message of messages) {
      this.broadcast(
        {
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
        },
        wss,
        wsDataMap
      );
    }
  }

  getBufferedEvents() {
    return this.streamingBuffer;
  }

  sendBufferedEvents(ws: any) {
    for (const encoded of this.streamingBuffer) {
      ws.send(encoded);
    }
  }
}

export class ChatManager {
  private sessions = new Map<string, ChatSession>();

  constructor(
    private wss: WebSocketServer,
    private wsDataMap: WeakMap<
      WebSocket,
      { type: "token"; id: string } | { type: "chat"; chatID: string }
    >,
    private getDB: () => Promise<Querier>,
    private env: RunChatEnv
  ) {}

  private getSession(id: string): ChatSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = new ChatSession(id);
      this.sessions.set(id, session);
    }
    return session;
  }

  async handleStream(id: string, request: Request): Promise<Response> {
    const session = this.getSession(id);

    // Handle SSE
    if (request.headers.get("Accept") === "text/event-stream") {
      const transform = new TextEncoderStream();
      const writer = transform.writable.getWriter();
      session.addSSEStream(writer);

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

    return new Response("Bad Request", { status: 400 });
  }

  async handleStart(opts: { id: string; interrupt: boolean }) {
    const session = this.getSession(opts.id);
    const db = await this.getDB();
    await session.start({
      interrupt: opts.interrupt,
      db,
      env: this.env,
      wss: this.wss,
      wsDataMap: this.wsDataMap,
    });
  }

  async handleStop(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.stop();
    }
  }

  async handleMessagesChanged(
    event: "message.created" | "message.updated",
    id: string,
    messages: DBMessage[]
  ) {
    const session = this.getSession(id);
    await session.broadcastMessagesChanged(
      event,
      messages,
      this.wss,
      this.wsDataMap
    );
  }

  sendBufferedEventsToWebSocket(chatID: string, ws: any) {
    const session = this.sessions.get(chatID);
    if (session) {
      session.sendBufferedEvents(ws);
    }
  }
}

function encodeStreamChatEvent(event: StreamChatEvent): string {
  return [
    `event: ${event.event}`,
    `data: ${JSON.stringify(event.data)}`,
    "\n",
  ].join("\n");
}
