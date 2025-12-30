import type { UIMessagePart } from "ai";
import { z } from "zod";
import {
  assertResponseStatus,
  schemaCursorPaginatedRequest,
  schemaCursorPaginatedResponse,
  schemaMetadata,
} from "../client-helper";
import Client from "../client.browser";

export const schemaChatMessageFormat = z.enum(["ai-sdk"]);
export const schemaAISDKMessageParts = z.array(
  z.custom<UIMessagePart<any, any>>()
);
export const schemaChatMessageRole = z.enum(["user", "assistant", "system"]);
export type ChatMessageRole = z.infer<typeof schemaChatMessageRole>;
export type AISDKMessageParts = z.infer<typeof schemaAISDKMessageParts>;
export type ChatMessageFormat = z.infer<typeof schemaChatMessageFormat>;

const schemaChatMessageBase = z.object({
  id: z.uuid(),
  created_at: z.string().datetime(),
  chat_id: z.uuid(),
  metadata: schemaMetadata,
});

// Eventually, we may want to provide other formats as well.
const schemaChatMessageFormatAISDK = schemaChatMessageBase.extend({
  format: z.literal("ai-sdk"),
  parts: schemaAISDKMessageParts,
  role: schemaChatMessageRole,
});

export const schemaChatMessage = z.discriminatedUnion("format", [
  schemaChatMessageFormatAISDK,
]);

export type ChatMessage = z.infer<typeof schemaChatMessage>;

export const schemaListChatMessagesRequest =
  schemaCursorPaginatedRequest.extend({
    chat_id: z.uuid(),
    format: schemaChatMessageFormat.default("ai-sdk").optional(),
  });

export type ListChatMessagesRequest = z.infer<
  typeof schemaListChatMessagesRequest
>;

export const schemaListChatMessagesResponse =
  schemaCursorPaginatedResponse(schemaChatMessage);

export type ListChatMessagesResponse = z.infer<
  typeof schemaListChatMessagesResponse
>;

export const schemaDeleteChatMessageRequest = z.object({
  chat_id: z.uuid(),
  message_id: z.uuid(),
});

export type DeleteChatMessageRequest = z.infer<
  typeof schemaDeleteChatMessageRequest
>;

export const schemaCreateChatMessage = z.object({
  id: z.uuid().optional(),
  role: schemaChatMessageRole,
  parts: schemaAISDKMessageParts,
  metadata: schemaMetadata.optional(),
  format: z.literal("ai-sdk").optional(),
});

export type CreateChatMessage = z.infer<typeof schemaCreateChatMessage>;

export const schemaUpdateMessageRequest = z.object({
  message_id: z.uuid(),
  metadata: schemaMetadata.optional(),
  role: schemaChatMessageRole.optional(),
  parts: schemaAISDKMessageParts.optional(),
  format: z.literal("ai-sdk").optional(),
  behavior: z.enum(["interrupt", "enqueue", "none"]).optional(),
});

export type UpdateMessageRequest = z.infer<typeof schemaUpdateMessageRequest>;

export const schemaSendMessagesBehavior = z.enum([
  // Add messages and start eventually.
  "enqueue",
  // Add messages and start instantly.
  "interrupt",
  // Add only. Don't start.
  "append",
]);

export type SendMessagesBehavior = z.infer<typeof schemaSendMessagesBehavior>;

export const schemaSendMessagesRequest = z.object({
  chat_id: z.uuid(),
  behavior: schemaSendMessagesBehavior.optional(),
  messages: z.array(schemaCreateChatMessage).min(1),
});

export type SendMessagesRequest = z.infer<typeof schemaSendMessagesRequest>;

export const schemaSendMessagesResponse = z.object({
  messages: z.array(schemaChatMessage),
});

export type SendMessagesResponse = z.infer<typeof schemaSendMessagesResponse>;

export default class Messages {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List messages for a chat.
   *
   * @param request - The request body.
   * @returns The list of messages.
   */
  public async list(
    request: ListChatMessagesRequest
  ): Promise<ListChatMessagesResponse> {
    const query = new URLSearchParams();
    query.set("chat_id", request.chat_id);
    if (request.limit) {
      query.set("limit", request.limit.toString());
    }
    if (request.cursor) {
      query.set("cursor", request.cursor);
    }
    if (request.format) {
      query.set("format", request.format);
    }
    const resp = await this.client.request(
      "GET",
      `/api/messages?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete a message.
   *
   * @param request - The request body.
   */
  public async delete(id: string): Promise<void> {
    const resp = await this.client.request("DELETE", `/api/messages/${id}`);
    await assertResponseStatus(resp, 204);
  }

  /**
   * Get a message.
   *
   * @param id - The ID of the message.
   * @returns The message.
   */
  public async get(id: string): Promise<ChatMessage> {
    const resp = await this.client.request("GET", `/api/messages/${id}`);
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  public async update(request: UpdateMessageRequest): Promise<void> {
    const resp = await this.client.request(
      "PUT",
      `/api/messages/${request.message_id}`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
  }

  /**
   * Send messages to a chat.
   *
   * @param request - The request body.
   */
  public async send(
    request: SendMessagesRequest
  ): Promise<SendMessagesResponse> {
    const resp = await this.client.request(
      "POST",
      `/api/messages`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 201);
    return resp.json();
  }
}
