import type { UIMessageChunk } from "ai";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { z } from "zod";
import {
  assertResponseStatus,
  createEventStreamFromReadable,
  schemaCursorPaginatedRequest,
  schemaCursorPaginatedResponse,
  schemaMetadata,
  streamSSE,
} from "../../client-helper";
import Client from "../../client.browser";
import { type AsyncIterableStream } from "../../util/async-iterable-stream";
import { schemaAgent } from "../agents/agents.client";
import {
  schemaChatMessage,
  schemaCreateChatMessage,
  type ChatMessage,
} from "../messages.client";
import ChatRuns from "./runs.client";
import ChatSteps from "./steps.client";

export const schemaChatStatus = z.enum([
  "streaming",
  "idle",
  "error",
  "interrupted",
]);

export type ChatStatus = z.infer<typeof schemaChatStatus>;

export const schemaChatVisibility = z.enum([
  "private",
  "organization",
  "public",
]);

export const schemaChat = z.object({
  id: z.uuid(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  created_by: z.uuid().nullable(),
  organization_id: z.uuid(),
  title: z.string().nullable(),
  visibility: schemaChatVisibility,
  metadata: schemaMetadata,
  archived: z.boolean(),
  status: schemaChatStatus,
  error: z.string().nullable(),
  agent_deployment_id: z.uuid().nullable(),
  agent: schemaAgent,
  expire_ttl: z.number().int().positive().nullable(),
  expires_at: z.iso.datetime().nullable(),
});

export type Chat = z.infer<typeof schemaChat>;

// Transport options for chat streaming
export const schemaStreamChatTransport = z.enum(["websocket", "sse"]);
export type StreamChatTransport = z.infer<typeof schemaStreamChatTransport>;

// Base request properties for creating a chat
const schemaCreateChatRequestBase = z.object({
  organization_id: z.uuid(),
  title: z.string().optional(),
  visibility: schemaChatVisibility.default("private").optional(),
  metadata: schemaMetadata.optional(),

  agent_id: z.uuid(),
  agent_deployment_id: z.uuid().optional(),
  messages: z.array(schemaCreateChatMessage).optional(),
});

const schemaCreateChatRequestStreaming = schemaCreateChatRequestBase.extend({
  stream: z.literal(true),
});

// Non-streaming variant: stream absent or false; transport must be undefined
const schemaCreateChatRequestNonStreaming = schemaCreateChatRequestBase.extend({
  stream: z.literal(false).optional(),
});

export const schemaCreateChatRequest = z.union([
  schemaCreateChatRequestStreaming,
  schemaCreateChatRequestNonStreaming,
]);

export type CreateChatRequest = z.infer<typeof schemaCreateChatRequest>;

export const schemaListChatsRequest = z.union([
  schemaCursorPaginatedRequest.extend({
    organization_id: z.uuid(),
  }),
  schemaCursorPaginatedRequest.extend({
    agent_id: z.uuid(),
  }),
]);

export const schemaCreateChatResponse = schemaChat.extend({
  messages: z.array(schemaChatMessage),
});

export type CreateChatResponse = z.infer<typeof schemaCreateChatResponse>;

export type ListChatsRequest = z.infer<typeof schemaListChatsRequest>;

export const schemaListChatsResponse =
  schemaCursorPaginatedResponse(schemaChat);

export type ListChatsResponse = z.infer<typeof schemaListChatsResponse>;

export type StreamChatOptions = {
  transport?: StreamChatTransport;
  signal?: AbortSignal;
};

export const schemaStreamChatEvent = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("chat.updated"),
    data: schemaChat,
  }),

  z.strictObject({
    event: z.literal("message.created"),
    data: schemaChatMessage,
  }),
  z.strictObject({
    event: z.literal("message.updated"),
    data: schemaChatMessage,
  }),
  z.strictObject({
    event: z.literal("message.deleted"),
    data: z.object({
      id: z.uuid(),
    }),
  }),
  z.strictObject({
    event: z.literal("message.chunk.added"),
    data: z.object({
      id: z.uuid(),
      chunk: z.custom<UIMessageChunk>(),
    }),
  }),
]);

// This event is only sent once when a chat is created,
// so it's not part of the normal chat stream event schema.
export const schemaStreamChatCreatedEvent = z.strictObject({
  event: z.literal("chat.created"),
  data: schemaCreateChatResponse,
});

export type StreamChatEvent = z.infer<typeof schemaStreamChatEvent>;
export type StreamChat = AsyncIterableStream<StreamChatEvent>;

export interface ChatWithStream extends Chat {
  readonly id: string;
  readonly stream: AsyncIterableStream<StreamChatEvent>;
  readonly messages: ChatMessage[];
}

export default class Chats {
  private readonly client: Client;

  /**
   * Runs are the execution history of a chat.
   */
  public readonly runs: ChatRuns;
  public readonly steps: ChatSteps;

  public constructor(client: Client) {
    this.client = client;
    this.runs = new ChatRuns(client);
    this.steps = new ChatSteps(client);
  }

  /**
   * Create a new chat.
   *
   * - When `stream: true` is provided, returns an AsyncIterable stream of chat events.
   * - Otherwise, returns the created chat.
   *
   * @param request - The request body.
   */
  public async create(
    request: z.infer<typeof schemaCreateChatRequestStreaming>
  ): Promise<ChatWithStream>;
  public async create(
    request: z.infer<typeof schemaCreateChatRequestNonStreaming>
  ): Promise<CreateChatResponse>;
  public async create(
    request: CreateChatRequest
  ): Promise<CreateChatResponse | ChatWithStream> {
    const headers: Record<string, string> = {};
    if (request.stream) {
      headers["Accept"] = "text/event-stream";
    }
    const resp = await this.client.request(
      "POST",
      "/api/chats",
      JSON.stringify(request),
      {
        headers,
      }
    );
    await assertResponseStatus(resp, 201);
    if (request.stream) {
      const contentType = resp.headers.get("Content-Type");
      if (contentType !== "text/event-stream") {
        throw new Error(`Expected text/event-stream, got ${contentType}`);
      }
      if (!resp.body) {
        throw new Error("The stream endpoint did not return a body!");
      }
      const stream = streamSSE(
        resp,
        z.discriminatedUnion("event", [
          schemaStreamChatEvent,
          schemaStreamChatCreatedEvent,
        ])
      );

      // Await an initial message with the chat and messages.
      // This message never occurs again, it's just a normal
      // stream after this.
      const reader = stream.getReader();
      const { done, value } = await reader.read();
      if (done) {
        throw new Error(
          "The stream ended before the chat.created event was received!"
        );
      }
      if (value.event !== "chat.created") {
        throw new Error(`Expected chat.created, got ${value.event}`);
      }
      reader.releaseLock();
      return {
        ...value.data,
        messages: value.data.messages,
        stream: stream as AsyncIterableStream<StreamChatEvent>,
      };
    }
    return resp.json();
  }

  /**
   * Get a chat by ID.
   *
   * @param id - The ID of the chat.
   * @returns The chat.
   */
  public async get(id: string): Promise<Chat> {
    const resp = await this.client.request("GET", `/api/chats/${id}`);
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * List chats.
   * The sort order is descending by created_at.
   *
   * @param request - The request body.
   * @returns The list of chats.
   */
  public async list(request: ListChatsRequest): Promise<ListChatsResponse> {
    const params = new URLSearchParams();
    if ("organization_id" in request && request.organization_id) {
      params.set("organization_id", request.organization_id);
    } else if ("agent_id" in request && request.agent_id) {
      params.set("agent_id", request.agent_id);
    }
    if (request.cursor) {
      params.set("cursor", request.cursor);
    }
    if (request.limit) {
      params.set("limit", request.limit.toString());
    }
    const resp = await this.client.request(
      "GET",
      `/api/chats?${params.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete a chat by ID.
   *
   * @param id - The ID of the chat.
   * @returns The void.
   */
  public async delete(id: string): Promise<void> {
    const resp = await this.client.request("DELETE", `/api/chats/${id}`);
    await assertResponseStatus(resp, 204);
  }

  /**
   * Idempotently stops a chat.
   *
   * @param id - The ID of the chat.
   * @returns The chat.
   */
  public async stop(id: string): Promise<void> {
    const resp = await this.client.request("POST", `/api/chats/${id}/stop`);
    await assertResponseStatus(resp, 200);
  }

  /**
   * Stream a chat.
   *
   * @param request - The request body.
   */
  public async stream(
    id: string,
    options: StreamChatOptions = {
      // TODO: Update this to use SSE.
      transport: "websocket",
    }
  ): Promise<AsyncIterableStream<StreamChatEvent>> {
    if (options?.transport === "websocket") {
      return this.streamWS(id, options?.signal);
    }

    const req = await this.client.request(
      "GET",
      `/api/chats/${id}/stream`,
      undefined,
      {
        abortSignal: options?.signal,
        headers: {
          Accept: "text/event-stream",
        },
      }
    );
    await assertResponseStatus(req, 200);
    return streamSSE<typeof schemaStreamChatEvent>(req, schemaStreamChatEvent);
  }

  /**
   * Stream a chat over a WebSocket.
   *
   * @param id - The ID of the chat.
   * @returns The stream of events.
   */
  private streamWS(
    id: string,
    signal?: AbortSignal
  ): AsyncIterableStream<StreamChatEvent> {
    const ws = this.client.websocket(`/api/chats/${id}/stream`);
    const parser = new EventSourceParserStream();
    const writer = parser.writable.getWriter();
    let lastWritePromise: Promise<void> | undefined;
    const decoder = new TextDecoder();
    let isClosed = false;

    const cleanup = () => {
      if (isClosed) {
        return;
      }
      isClosed = true;

      // Wait for any pending writes before closing
      if (lastWritePromise) {
        lastWritePromise.finally(() => {
          writer.close().catch(() => {});
        });
      } else {
        writer.close().catch(() => {});
      }

      try {
        ws.close();
      } catch {}
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
      } else {
        signal.addEventListener("abort", cleanup, { once: true });
      }
    }

    ws.addEventListener("error", () => {
      cleanup();
    });
    ws.addEventListener("close", () => {
      cleanup();
    });

    ws.addEventListener("message", (event) => {
      if (isClosed) return;

      let str: string;
      if (typeof event.data === "string") {
        str = event.data;
      } else {
        str = decoder.decode(event.data);
      }
      if (!lastWritePromise) {
        lastWritePromise = writer.write(str).catch(() => {});
      } else {
        lastWritePromise = lastWritePromise.then(() => {
          if (!isClosed) {
            return writer.write(str).catch(() => {});
          }
        });
      }
    });

    return createEventStreamFromReadable(
      parser.readable,
      schemaStreamChatEvent
    );
  }
}
