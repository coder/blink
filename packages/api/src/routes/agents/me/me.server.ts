import type { Chat } from "@blink.so/database/schema";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { decode, encode } from "next-auth/jwt";
import { validate } from "uuid";
import type { Bindings } from "../../../server";
import { handleInsertMessages, validateMessages } from "../../messages.server";
import type { SendMessagesRequest } from "./me.client";

// Mount the /api/agents/me routes.
// This is *only* available for agent invocations.
export default function mountAgentsMe(app: Hono<{ Bindings: Bindings }>) {
  // Get the value of a key.
  app.get("/storage/:key", withAgentInvocationAuth, async (c) => {
    const target = c.get("agent_deployment_target_id");
    const value = await c.env.agentStore(target).get(c.req.param("key"));
    if (!value) {
      return c.body(null, 404);
    }
    return c.body(value, 200, {
      "Content-Type": "application/octet-stream",
    });
  });

  // Set the value of a key.
  app.put(
    "/storage/:key",
    withAgentInvocationAuth,
    bodyLimit({
      maxSize: 20_000,
      onError: (c) => {
        return c.json({ error: "Request body too large" }, 413);
      },
    }),
    async (c) => {
      const target = c.get("agent_deployment_target_id");
      const key = c.req.param("key");
      const value = await c.req.text();
      const { ttl } = c.req.query();
      await c.env.agentStore(target).set(key, value, {
        ttl: ttl ? parseInt(ttl) : undefined,
      });
      return c.body(null, 204);
    }
  );

  // Delete a key.
  app.delete("/storage/:key", withAgentInvocationAuth, async (c) => {
    const target = c.get("agent_deployment_target_id");
    const key = c.req.param("key");
    await c.env.agentStore(target).delete(key);
    return c.body(null, 204);
  });

  // List values.
  app.get("/storage", withAgentInvocationAuth, async (c) => {
    const target = c.get("agent_deployment_target_id");
    const { prefix, limit, cursor } = c.req.query();
    const values = await c.env.agentStore(target).list(prefix, {
      limit: limit ? parseInt(limit) : 100,
      cursor,
    });
    return c.json(values, 200);
  });

  // Upsert a chat by key.
  app.put(
    "/chats/:key",
    withAgentInvocationAuth,
    validator("param", (value, c) => {
      const key = value["key"];
      if (!key) {
        return c.json({ error: "Invalid Key" }, 400);
      }
      if (key.length > 128) {
        return c.json({ error: "Invalid Key" }, 400);
      }
      return key;
    }),
    async (c) => {
      const key = c.req.valid("param");
      const db = await c.env.database();
      const agent = await db.selectAgentByID(c.get("agent_id"));
      if (!agent) {
        return c.json({ error: "Agent not found" }, 404);
      }
      const deployment = await db.selectAgentDeploymentByIDOrActive({
        agentID: agent.id,
        id: c.get("agent_deployment_id"),
      });
      if (!deployment) {
        return c.json({ error: "Deployment not found" }, 404);
      }
      const { id, created_at, created } =
        await db.upsertChatForAgentDeploymentTarget({
          created_at: new Date(),
          organization_id: agent.organization_id,
          visibility: "private",
          agent_deployment_id: c.get("agent_deployment_id"),
          agent_deployment_target_id: c.get("agent_deployment_target_id"),
          agent_id: c.get("agent_id"),
          agent_key: key,
          title: null,
        });
      if (deployment.compatibility_version !== "3") {
        return c.body(null, 204);
      }
      return c.json(
        {
          id,
          created_at: created_at.toISOString(),
          created,
        },
        200
      );
    }
  );

  // Insert chat messages by ID.
  app.post(
    "/chats/:id/messages",
    withAgentInvocationAuth,
    validator("json", (value, c) => {
      if (!value["messages"]) {
        return c.json({ error: "Invalid messages" }, 400);
      }
      if (!value["behavior"]) {
        return c.json({ error: "Invalid behavior" }, 400);
      }
      return value as SendMessagesRequest;
    }),
    async (c) => {
      const req = c.req.valid("json");
      const id = c.req.param("id");

      await validateMessages(req.messages);

      const db = await c.env.database();

      let chat: Chat | undefined;
      if (validate(id)) {
        chat = await db.selectChatByID({ id });
      } else {
        chat = await db.selectChatByAgentKey({
          agentID: c.get("agent_id"),
          key: id,
        });
      }
      if (!chat) {
        return c.json({ error: "Chat not found" }, 404);
      }
      // Verify the chat belongs to this agent
      if (chat.agent_id !== c.get("agent_id")) {
        return c.json({ error: "Unauthorized" }, 403);
      }

      await handleInsertMessages(c, {
        chat,
        messages: req.messages,
        behavior: req.behavior,
        agent_id: c.get("agent_id"),
        // Deployments that start chats should use their own
        // agent deployment so that the behavior is consistent
        // with the deployed version on start.
        agent_deployment_id: c.get("agent_deployment_id"),
      });

      return c.body(null, 204);
    }
  );

  // Get a chat by ID.
  app.get("/chats/:id", withAgentInvocationAuth, async (c) => {
    const db = await c.env.database();
    const chat = await db.selectChatByID({ id: c.req.param("id") });
    if (!chat) {
      return c.body(null, 404);
    }
    // Verify the chat belongs to this agent.
    if (chat.agent_id !== c.get("agent_id")) {
      return c.json({ error: "Unauthorized" }, 403);
    }
    return c.json(
      {
        id: chat.id,
        createdAt: chat.created_at.toISOString(),
      },
      200
    );
  });

  // Delete a chat by ID.
  app.delete("/chats/:id", withAgentInvocationAuth, async (c) => {
    const db = await c.env.database();
    const chat = await db.selectChatByID({ id: c.req.param("id") });
    if (!chat) {
      return c.body(null, 404);
    }
    // Verify the chat belongs to this agent.
    if (chat.agent_id !== c.get("agent_id")) {
      return c.json({ error: "Unauthorized" }, 403);
    }
    await db.deleteChatByID(chat.id);
    return c.body(null, 204);
  });

  // Start a chat by ID.
  app.post("/chats/:id/start", withAgentInvocationAuth, async (c) => {
    const db = await c.env.database();
    const chat = await db.selectChatByID({ id: c.req.param("id") });
    if (!chat) {
      return c.json({ error: "Chat not found" }, 404);
    }
    // Verify the chat belongs to this agent.
    if (chat.agent_id !== c.get("agent_id")) {
      return c.json({ error: "Unauthorized" }, 403);
    }
    await c.env.chat.handleStart({
      id: chat.id,
      interrupt: false,
    });
    return c.body(null, 204);
  });

  // Stop a chat by ID.
  app.post("/chats/:id/stop", withAgentInvocationAuth, async (c) => {
    const db = await c.env.database();
    const chat = await db.selectChatByID({ id: c.req.param("id") });
    if (!chat) {
      return c.json({ error: "Chat not found" }, 404);
    }
    // Verify the chat belongs to this agent.
    if (chat.agent_id !== c.get("agent_id")) {
      return c.json({ error: "Unauthorized" }, 403);
    }
    await c.env.chat.handleStop(chat.id);
    return c.body(null, 204);
  });

  // Get messages from a chat by ID.
  app.get("/chats/:id/messages", withAgentInvocationAuth, async (c) => {
    const db = await c.env.database();
    const chat = await db.selectChatByID({ id: c.req.param("id") });
    if (!chat) {
      return c.json({ error: "Chat not found" }, 404);
    }
    // Verify the chat belongs to this agent.
    if (chat.agent_id !== c.get("agent_id")) {
      return c.json({ error: "Unauthorized" }, 403);
    }
    const messages = await db.selectChatMessages({
      chatID: chat.id,
      limit: 1000,
    });
    return c.json(
      messages.items.map((message) => ({
        id: message.id,
        role: message.role,
        parts: message.parts,
        metadata: message.metadata,
      })),
      200
    );
  });

  // Delete messages from a chat by ID.
  app.post(
    "/chats/:id/messages/delete",
    withAgentInvocationAuth,
    validator("json", (value, c) => {
      if (!value["message_ids"] || !Array.isArray(value["message_ids"])) {
        return c.json({ error: "Invalid message_ids" }, 400);
      }
      return { message_ids: value["message_ids"] as string[] };
    }),
    async (c) => {
      const db = await c.env.database();
      const chat = await db.selectChatByID({ id: c.req.param("id") });
      if (!chat) {
        return c.json({ error: "Chat not found" }, 404);
      }
      // Verify the chat belongs to this agent.
      if (chat.agent_id !== c.get("agent_id")) {
        return c.json({ error: "Unauthorized" }, 403);
      }
      const req = c.req.valid("json");
      await db.deleteChatMessages(req.message_ids);
      return c.body(null, 204);
    }
  );
}

export const withAgentInvocationAuth: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AgentInvocationToken;
}> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const tokenValue = authHeader.substring(7);
  let token;
  try {
    token = await decode({
      token: tokenValue,
      secret: c.env.AUTH_SECRET,
      salt: "agent-invocation",
    });
  } catch {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  if (!token) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  if (
    !token.agent_id ||
    !token.agent_deployment_id ||
    !token.agent_deployment_target_id
  ) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("agent_id", token.agent_id as string);
  c.set("agent_deployment_id", token.agent_deployment_id as string);
  c.set(
    "agent_deployment_target_id",
    token.agent_deployment_target_id as string
  );
  if (token.run_id) {
    c.set("run_id", token.run_id as string);
  }
  if (token.step_id) {
    c.set("step_id", token.step_id as string);
  }
  if (token.chat_id) {
    c.set("chat_id", token.chat_id as string);
  }
  await next();
};

export interface AgentInvocationToken {
  agent_id: string;
  agent_deployment_id: string;
  agent_deployment_target_id: string;
  run_id?: string;
  step_id?: string;
  chat_id?: string;
}

export const generateAgentInvocationToken = (
  authSecret: string,
  params: AgentInvocationToken
) => {
  return encode({
    salt: "agent-invocation",
    secret: authSecret,
    // These tokens only last for 5 minutes.
    maxAge: 5 * 60,
    token: {
      agent_id: params.agent_id,
      agent_deployment_id: params.agent_deployment_id,
      agent_deployment_target_id: params.agent_deployment_target_id,
      run_id: params.run_id,
      step_id: params.step_id,
      chat_id: params.chat_id,
    },
  });
};
