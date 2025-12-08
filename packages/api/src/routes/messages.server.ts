import * as convert from "@blink.so/database/convert";
import type {
  Chat as DBChat,
  DBMessage,
  OrganizationWithMembership,
} from "@blink.so/database/schema";
import { TypeValidationError, validateUIMessages } from "ai";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { MESSAGE_LIMITS } from "../constants";
import { withAuth, withCursorPagination } from "../middleware";
import type { APIServer, Bindings } from "../server";
import { authorizeChat } from "./chats/chats.server";
import {
  schemaChatMessageFormat,
  schemaSendMessagesRequest,
  schemaUpdateMessageRequest,
  type AISDKMessageParts,
  type ChatMessageRole,
  type ListChatMessagesResponse,
  type SendMessagesBehavior,
  type SendMessagesRequest,
  type SendMessagesResponse,
} from "./messages.client";

export default function mountMessages(server: APIServer) {
  // Debug message - redirects to traces page with appropriate filters
  server.get("/:message_id/debug", withAuth, withMessageURLParam, async (c) => {
    const message = c.get("message");
    const chat = c.get("chat");
    const organization = c.get("organization");
    const db = await c.env.database();

    if (!chat.agent_id) {
      throw new HTTPException(400, {
        message: "Chat does not have an associated agent!",
      });
    }

    const agent = await db.selectAgentByID(chat.agent_id);
    if (!agent) {
      throw new HTTPException(404, { message: "Agent not found!" });
    }

    // Build filters JSON based on available IDs
    const filters: {
      type: "and";
      filters: Array<{ type: "eq"; key: string; value: string }>;
    } = {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.parent_span_id",
          value: "",
        },
      ],
    };
    filters.filters.push({
      type: "eq",
      key: "resource.attributes.blink.chat_id",
      value: message.chat_id,
    });
    if (message.chat_run_step_id) {
      filters.filters.push({
        type: "eq",
        key: "resource.attributes.blink.step_id",
        value: message.chat_run_step_id,
      });
    }
    if (message.chat_run_id) {
      filters.filters.push({
        type: "eq",
        key: "resource.attributes.blink.run_id",
        value: message.chat_run_id,
      });
    }

    // Calculate start_time and end_time (±15 minutes from message time)
    // Using a short time range will result in a quick ClickHouse query, since
    // spans are indexed by start_time.
    const messageTime = new Date(message.created_at);
    let startTime = new Date(messageTime.getTime() - 15 * 60 * 1000); // 15 minutes before
    const endTime = new Date(messageTime.getTime() + 15 * 60 * 1000); // 15 minutes after
    if (message.role === "user") {
      // user messages will only contain the chat id filter, so they may contain spans
      // unrelated to the actual user message. we limit the time range to 30 seconds before
      // to avoid showing too many irrelevant spans.
      startTime = new Date(messageTime.getTime() - 30 * 1000);
    }

    // Build the redirect URL
    const redirectUrl = `/${organization.name}/${agent.name}/traces?filters=${encodeURIComponent(JSON.stringify(filters))}&start_time=${encodeURIComponent(startTime.toISOString())}&end_time=${encodeURIComponent(endTime.toISOString())}`;

    return c.redirect(redirectUrl);
  });

  // List messages.
  server.get(
    "/",
    withAuth,
    withChatQueryParam,
    withCursorPagination,
    validator("query", (data) => {
      return {
        format: schemaChatMessageFormat.parse(data.format ?? "ai-sdk"),
      };
    }),
    async (c) => {
      const chat = c.get("chat");
      const db = await c.env.database();
      const req = c.req.valid("query");
      const messages = await db.selectChatMessages({
        chatID: chat.id,
        cursor: c.get("cursor"),
        limit: c.get("limit"),
      });

      const resp: ListChatMessagesResponse = {
        next_cursor: messages.next_cursor,
        items: messages.items.map((message) =>
          convert.message(req.format, message)
        ),
      };
      return c.json(resp);
    }
  );

  // Delete a message.
  server.delete("/:message_id", withAuth, withMessageURLParam, async (c) => {
    const db = await c.env.database();
    const message = c.get("message");
    await db.deleteChatMessage(message.id);
    return c.body(null, 204);
  });

  // Get a message.
  server.get("/:message_id", withAuth, withMessageURLParam, async (c) => {
    const message = c.get("message");
    return c.json(convert.message("ai-sdk", message));
  });

  // Update a message.
  server.put(
    "/:message_id",
    withAuth,
    withMessageURLParam,
    validator("json", (data) => {
      return schemaUpdateMessageRequest.parse(data);
    }),
    async (c) => {
      const db = await c.env.database();
      const req = c.req.valid("json");
      const message = c.get("message");

      await validateMessages([
        {
          role: req.role ?? message.role,
          parts: req.parts ?? message.parts,
        },
      ]);

      const updates: Partial<DBMessage> = {};
      if (req.role) {
        updates.role = req.role;
      }
      if (req.parts) {
        updates.parts = req.parts;
      }
      if (req.metadata) {
        updates.metadata = req.metadata;
      }

      const updated = await db.updateChatMessage({
        id: message.id,
        ...updates,
      });

      await c.env.chat.handleMessagesChanged(
        "message.updated",
        message.chat_id,
        [updated]
      );

      if (req.behavior && req.behavior !== "none") {
        await c.env.chat.handleStart({
          id: message.chat_id,
          interrupt: req.behavior === "interrupt",
        });
      }

      return c.json(convert.message(req.format ?? "ai-sdk", updated), 200);
    }
  );

  // Send a message.
  server.post(
    "/",
    withAuth,
    validator("json", (data) => {
      return schemaSendMessagesRequest.parse(data);
    }),
    async (c) => {
      const req = c.req.valid("json");
      const { chat } = await authorizeChat(c, req.chat_id);

      await validateMessages(req.messages);

      if (!chat.agent_id) {
        throw new HTTPException(400, {
          message: "Chat has no agent. Legacy chats cannot use this endpoint.",
        });
      }

      const messages = await handleInsertMessages(c, {
        chat,
        messages: req.messages,
        // By default, we enqueue messages.
        behavior: req.behavior ?? "enqueue",
        agent_id: chat.agent_id,
        agent_deployment_id: chat.agent_deployment_id ?? undefined,
      });

      const resp: SendMessagesResponse = {
        messages: messages.map((message) => convert.message("ai-sdk", message)),
      };

      return c.json(resp, 201);
    }
  );
}

// Estimate the size of a message part in bytes
function estimatePartSize(part: AISDKMessageParts[number]): number {
  const json = JSON.stringify(part);
  return Buffer.byteLength(json, "utf-8");
}

// Extract data URL content length
function getDataUrlSize(url: string): number {
  if (!url.startsWith("data:")) {
    return 0;
  }

  const commaIndex = url.indexOf(",");
  if (commaIndex === -1) {
    return 0;
  }

  const data = url.slice(commaIndex + 1);
  const isBase64 = url.slice(0, commaIndex).includes("base64");

  if (isBase64) {
    // Base64 encoded: 4 chars = 3 bytes
    const base64Data = data.replace(/=/g, "");
    return Math.floor((base64Data.length * 3) / 4);
  } else {
    return Buffer.byteLength(decodeURIComponent(data), "utf-8");
  }
}

export function validateMessageSizes(
  messages: Array<{
    role: ChatMessageRole;
    parts: AISDKMessageParts;
  }>
): void {
  for (const message of messages) {
    if (message.parts.length > MESSAGE_LIMITS.MAX_PARTS_PER_MESSAGE) {
      throw new HTTPException(413, {
        message: `Message has too many parts (${message.parts.length}). Maximum allowed: ${MESSAGE_LIMITS.MAX_PARTS_PER_MESSAGE}`,
      });
    }

    let totalMessageSize = 0;

    for (const part of message.parts) {
      const partSize = estimatePartSize(part);

      if (part.type === "file" && part.url) {
        const dataUrlSize = getDataUrlSize(part.url);
        if (dataUrlSize > MESSAGE_LIMITS.MAX_PART_SIZE_BYTES) {
          throw new HTTPException(413, {
            message: `File data URL is too large (${Math.round(dataUrlSize / 1024 / 1024)}MB). Maximum allowed: ${Math.round(MESSAGE_LIMITS.MAX_PART_SIZE_BYTES / 1024 / 1024)}MB. Use the /api/files endpoint for large files.`,
          });
        }
      }

      if (partSize > MESSAGE_LIMITS.MAX_PART_SIZE_BYTES) {
        throw new HTTPException(413, {
          message: `Message part is too large (${Math.round(partSize / 1024 / 1024)}MB). Maximum allowed: ${Math.round(MESSAGE_LIMITS.MAX_PART_SIZE_BYTES / 1024 / 1024)}MB`,
        });
      }

      totalMessageSize += partSize;
    }

    if (totalMessageSize > MESSAGE_LIMITS.MAX_MESSAGE_SIZE_BYTES) {
      throw new HTTPException(413, {
        message: `Total message size is too large (${Math.round(totalMessageSize / 1024 / 1024)}MB). Maximum allowed: ${Math.round(MESSAGE_LIMITS.MAX_MESSAGE_SIZE_BYTES / 1024 / 1024)}MB`,
      });
    }
  }
}

export const validateMessages = async (
  messages: Array<{
    role: ChatMessageRole;
    parts: AISDKMessageParts;
  }>
): Promise<void> => {
  // Validate message sizes first
  validateMessageSizes(messages);

  try {
    await validateUIMessages({
      messages: messages.map((message, index) => {
        return {
          // It needs an index to validate the schema.
          id: `${index}`,
          role: message.role,
          parts: message.parts,
        };
      }),
    });
  } catch (error) {
    if (error instanceof TypeValidationError) {
      throw new HTTPException(400, {
        message: "Invalid message parts",
        cause: error.message,
      });
    }
    throw error;
  }
};

const withMessageURLParam: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    chat: DBChat;
    message: DBMessage;
    organization: OrganizationWithMembership;
  };
}> = async (c, next) => {
  const id = c.req.param("message_id");
  if (!id) {
    return c.json({ message: "Message ID is required" }, 400);
  }
  const db = await c.env.database();
  const message = await db.selectMessageByID({ id });
  if (!message) {
    return c.json({ message: "Message not found" }, 404);
  }
  // Use authorizeChat to properly check permissions.
  const { chat, organization } = await authorizeChat(c, message.chat_id);
  c.set("chat", chat);
  c.set("organization", organization);
  c.set("message", message);
  await next();
};

const withChatQueryParam: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    chat: DBChat;
    organization: OrganizationWithMembership;
  };
}> = async (c, next) => {
  const id = c.req.query("chat_id");
  if (!id) {
    return c.json(
      { message: `The \"chat_id\" query parameter is required` },
      400
    );
  }
  // Use authorizeChat to properly check permissions.
  const { chat, organization } = await authorizeChat(c, id);
  c.set("chat", chat);
  c.set("organization", organization);
  await next();
};

// handleInsertMessages is a helper function that anywhere in the codebase
// can use to properly insert messages and maybe start a chat run.
export const handleInsertMessages = async (
  c: Context<{
    Bindings: Bindings;
    Variables: any;
  }>,
  req: {
    chat: Pick<DBChat, "id" | "title">;
    messages: SendMessagesRequest["messages"];
    behavior: SendMessagesBehavior;
    agent_id: string;
    agent_deployment_id?: string;
  }
) => {
  const db = await c.env.database();

  const messages = await db.insertMessages({
    messages: req.messages.map((message) => ({
      chat_id: req.chat.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
    })),
  });

  if (req.behavior !== "append") {
    await db.reconcileChatRun({
      behavior: req.behavior,
      chat_id: req.chat.id,
      agent_id: req.agent_id,
      agent_deployment_id: req.agent_deployment_id,
    });

    await c.env.chat.handleStart({
      id: req.chat.id,
      interrupt: req.behavior === "interrupt",
    });
  }

  // Publish these messages to the chat.
  // We can do this in the background so we don't block the request.
  c.executionCtx.waitUntil(
    c.env.chat.handleMessagesChanged("message.created", req.chat.id, messages)
  );

  // Generate title from first message(s) if chat has no title
  if (!req.chat.title && c.env.chat.generateTitle) {
    c.env.chat.generateTitle({
      messages: req.messages,
      id: req.chat.id,
    });
  }

  return messages;
};
