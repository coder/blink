import * as convert from "@blink.so/database/convert";
import type {
  ChatWithStatusAndAgent,
  DBMessage,
  OrganizationWithMembership,
} from "@blink.so/database/schema";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { validator } from "hono/validator";
import z from "zod";
import {
  authorizeOrganization,
  withAuth,
  withCursorPagination,
} from "../../middleware";
import type { APIServer, Bindings } from "../../server";
import { handleInsertMessages, validateMessages } from "../messages.server";
import {
  schemaCreateChatRequest,
  schemaStreamChatCreatedEvent,
  type CreateChatResponse,
  type ListChatsResponse,
} from "./chats.client";
import mountChatRuns from "./runs.server";
import mountChatSteps from "./steps.server";

export default function mountChats(app: APIServer) {
  // List chats.
  app.get("/", withAuth, withCursorPagination, async (c) => {
    const db = await c.env.database();

    let org = c.req.query("organization_id");
    if (org) {
      await authorizeOrganization(c, org);
    }
    const agentID = c.req.query("agent_id");
    let agentPermission: "read" | "write" | "admin" | undefined;
    if (agentID) {
      const agent = await db.selectAgentByID(agentID);
      if (!agent) {
        throw new HTTPException(404, {
          message: "Agent not found",
        });
      }
      const agentOrg = await authorizeOrganization(c, agent.organization_id);

      // Check agent permission for filtering
      if (
        agentOrg.membership &&
        (agentOrg.membership.role === "owner" ||
          agentOrg.membership.role === "admin")
      ) {
        agentPermission = "admin";
      } else {
        agentPermission = await db.getAgentPermissionForUser({
          agentId: agent.id,
          userId: c.get("user_id"),
          orgRole: agentOrg.membership?.role,
          agentVisibility: agent.visibility,
        });
        if (agentPermission === undefined) {
          throw new HTTPException(403, {
            message:
              "Access denied: private agent requires explicit permission",
          });
        }
      }
    }
    if (!agentID && !org) {
      const user = await db.selectUserByID(c.get("user_id"));
      if (!user) {
        throw new HTTPException(404, {
          message: "User not found",
        });
      }
      org = user.organization_id;
    }

    // Read users can only see their own chats
    let createdBy: string | undefined;
    if (agentPermission === "read") {
      createdBy = c.get("user_id");
    }

    const chats = await db.selectChats({
      organizationID: org!,
      agentID: agentID!,
      createdBy,
      cursor: c.get("cursor"),
      limit: c.get("limit"),
    });
    const resp: ListChatsResponse = {
      next_cursor: chats.next_cursor,
      items: chats.items.map((chat) => convert.chat(chat)),
    };
    return c.json(resp);
  });

  // Get a chat.
  app.get("/:chat_id", withAuth, withChatURLParam, async (c) => {
    const chat = c.get("chat");
    return c.json(convert.chat(chat));
  });

  // Delete a chat.
  app.delete("/:chat_id", withAuth, withChatURLParam, async (c) => {
    const db = await c.env.database();
    const chat = c.get("chat");
    await db.deleteChatByID(chat.id);
    return c.body(null, 204);
  });

  // Create a chat.
  app.post(
    "/",
    withAuth,
    validator("json", (data) => {
      return schemaCreateChatRequest.parse(data);
    }),
    async (c) => {
      const db = await c.env.database();
      const req = c.req.valid("json");
      const org = await authorizeOrganization(c, req.organization_id);

      // Verify the user can access the agent.
      const agent = await db.selectAgentByID(req.agent_id);
      if (!agent) {
        throw new HTTPException(404, {
          message: "Agent not found",
        });
      }
      if (agent.organization_id !== org.id) {
        // Ensure the user has access to that organization.
        await authorizeOrganization(c, agent.organization_id);
      }

      // Check agent visibility permissions
      const agentOrg = await db.selectOrganizationForUser({
        organizationID: agent.organization_id,
        userID: c.get("user_id"),
      });
      const permission = await db.getAgentPermissionForUser({
        agentId: agent.id,
        userId: c.get("user_id"),
        orgRole: agentOrg?.membership?.role,
        agentVisibility: agent.visibility,
      });
      if (permission === undefined) {
        throw new HTTPException(403, {
          message: "You don't have permission to access this agent",
        });
      }

      if (!agent.active_deployment_id) {
        return c.json(
          {
            error:
              "This agent has no active deployment. Please deploy it first to chat!",
          },
          400
        );
      }

      const chat = await db.insertChat({
        organization_id: org.id,
        title: req.title ?? "Untitled Chat",
        created_by: c.get("user_id"),
        visibility: req.visibility,
        metadata: req.metadata,
        agent_id: req.agent_id,
        agent_deployment_id: req.agent_deployment_id,
        expire_ttl: agent.chat_expire_ttl,
      });

      let messages: DBMessage[] = [];
      if (req.messages) {
        await validateMessages(req.messages);

        messages = await handleInsertMessages(c, {
          chat,
          messages: req.messages,
          behavior: "enqueue",
          agent_id: req.agent_id,
          agent_deployment_id: req.agent_deployment_id ?? undefined,
        });
      }

      // If we have messages and the user did not provide a title,
      // we will generate a title from the messages.
      if (
        req.messages &&
        req.messages.length > 0 &&
        !req.title &&
        c.env.chat.generateTitle
      ) {
        // Generate a title for users.
        c.env.chat.generateTitle({
          messages: req.messages,
          id: chat.id,
        });
      }

      const response: CreateChatResponse = {
        ...convert.chat({
          ...chat,
          updated_at: chat.created_at,
          error: null,
          agent,
          agent_deployment_id: req.agent_deployment_id ?? null,
          status: "idle",
          expires_at: chat.expire_ttl
            ? new Date(chat.created_at.getTime() + chat.expire_ttl * 1000)
            : null,
        }),
        messages: messages.map((message) => convert.message("ai-sdk", message)),
      };

      if (req.stream) {
        const response = await c.env.chat.handleStream(
          chat.id,
          new Request(c.req.url, {
            headers: c.req.raw.headers,
            method: c.req.raw.method,
          })
        );
        if (response.status !== 200) {
          const body = await response.text();
          throw new HTTPException(response.status as ContentfulStatusCode, {
            message: body,
          });
        }
        if (!response.body) {
          throw new HTTPException(response.status as ContentfulStatusCode, {
            message: "No body",
          });
        }
        const transform = new TransformStream<Uint8Array, Uint8Array>();
        const writer = transform.writable.getWriter();
        const event: z.infer<typeof schemaStreamChatCreatedEvent> = {
          event: "chat.created",
          data: {
            ...convert.chat({
              ...chat,
              updated_at: chat.created_at,
              error: null,
              agent,
              agent_deployment_id: req.agent_deployment_id ?? null,
              status: "streaming",
              expires_at: chat.expire_ttl
                ? new Date(chat.created_at.getTime() + chat.expire_ttl * 1000)
                : null,
            }),
            messages: messages.map((message) =>
              convert.message("ai-sdk", message)
            ),
          },
        };

        // Write the initial event.
        c.executionCtx.waitUntil(
          (async () => {
            await writer.write(
              new TextEncoder().encode(
                [
                  `event: ${event.event}`,
                  `data: ${JSON.stringify(event.data)}`,
                  "\n",
                ].join("\n")
              )
            );
            writer.releaseLock();
            await response.body?.pipeTo(transform.writable).catch((err) => {
              // noop - we can ignore.
            });
          })().catch((err) => {
            // noop - we can ignore.
          })
        );

        return new Response(transform.readable, {
          status: 201,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Transfer-Encoding": "chunked",
            Connection: "keep-alive",
          },
        });
      }

      return c.json(response, 201);
    }
  );

  // Stop a chat.
  app.post("/:chat_id/stop", withAuth, withChatURLParam, async (c) => {
    return c.env.chat.handleStop(c.get("chat").id);
  });

  // Stream a chat. TODO: We need to add auth here!
  app.get("/:chat_id/stream", async (c) => {
    return c.env.chat.handleStream(c.req.param("chat_id"), c.req.raw);
  });

  mountChatRuns(app.basePath("/:chat_id/runs"));
  mountChatSteps(app.basePath("/:chat_id/steps"));
}

export const authorizeChat = async <
  V extends {
    user_id: string;
  },
>(
  c: Context<{
    Bindings: Bindings;
    Variables: V;
  }>,
  id: string
): Promise<{
  chat: ChatWithStatusAndAgent;
  organization: OrganizationWithMembership;
}> => {
  const parsed = await z.uuid().safeParseAsync(id);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: "Invalid chat ID",
    });
  }
  const db = await c.env.database();
  const chat = await db.selectChatByID({ id: parsed.data });
  if (!chat) {
    throw new HTTPException(404, {
      message: "Chat not found",
    });
  }

  // Check if user owns the agent - if so, they can access regardless of chat org
  if (chat.agent.created_by === c.get("user_id")) {
    // Agent owner can always access. Return their membership in the agent's org.
    const org = await db.selectOrganizationForUser({
      organizationID: chat.agent.organization_id,
      userID: c.get("user_id"),
    });
    if (!org) {
      // Agent owner somehow lost access to agent's org - shouldn't happen but handle it
      throw new HTTPException(404, {
        message: "Chat not found",
      });
    }
    return { chat, organization: org };
  }

  const org = await authorizeOrganization(c, chat.organization_id);
  return { chat, organization: org };
};

export const withChatURLParam: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    chat: ChatWithStatusAndAgent;
    organization: OrganizationWithMembership;
  };
}> = async (c, next) => {
  const id = c.req.param("chat_id");
  if (!id) {
    return c.json({ message: "Chat ID is required" }, 400);
  }
  const { chat, organization } = await authorizeChat(c, id);
  c.set("chat", chat);
  c.set("organization", organization);
  await next();
};
