/**
 * This serves the Blink agent's context over an HTTP API.
 *
 * Allows you to create a server that will handle requests
 * to the Blink agent context.
 */

import type { UIMessage } from "ai";
import { Hono, type Context } from "hono";
import { validator } from "hono/validator";
import type {
  AgentChat,
  AgentOtel,
  AgentStore,
  ID,
  NewMessage,
  SendOptions,
} from "../agent/types";

const error = (c: Context, msg: string) => {
  return c.json(
    {
      error: msg,
    },
    400
  );
};

// Middleware is not supported in inferred response types.
// So we don't use middleware for validation.
const validateStorageKey = (c: Context): { key: string; err?: string } => {
  const key = c.req.param("key");
  if (!key || key === "") {
    return { key, err: "Key is required" };
  }
  if (key.length > 475) {
    return { key, err: "Key is too long. Max length is 475 characters." };
  }
  return { key };
};

const createRouter = () => {
  return new Hono<{
    Bindings: {
      chat: AgentChat;
      store: AgentStore;
      otlp: AgentOtel;
    };
  }>();
};

const kv = createRouter()
  // Get key.
  .get("/:key", async (c) => {
    const { key, err } = validateStorageKey(c);
    if (err) {
      return error(c, err);
    }
    const value = await c.env.store.get(key);
    return c.json(
      {
        value,
      },
      200
    );
  })
  // Set key.
  .post(
    "/:key",
    validator("json", (body, c) => {
      const value = body["value"];
      if (!value) {
        return error(c, "Value is required");
      }
      if (typeof value !== "string") {
        return error(c, "Value must be a string");
      }
      if (value.length > 20_000) {
        return error(c, "Value is too long. Max length is 20,000 characters.");
      }
      return {
        value,
      };
    }),
    async (c) => {
      const { key, err } = validateStorageKey(c);
      if (err) {
        return error(c, err);
      }
      const { value } = c.req.valid("json");
      await c.env.store.set(key, value);
      return c.body(null, 204);
    }
  )
  // Delete key.
  .delete("/:key", async (c) => {
    const { key, err } = validateStorageKey(c);
    if (err) {
      return error(c, err);
    }
    await c.env.store.delete(key);
    return c.body(null, 204);
  })
  // List keys.
  .get("/", async (c) => {
    const { cursor, limit, prefix } = c.req.query();
    const { entries, cursor: nextCursor } = await c.env.store.list(prefix, {
      cursor: cursor ? String(cursor) : undefined,
      limit: limit ? Number(limit) : 100,
    });
    return c.json({
      entries,
      cursor: nextCursor,
    });
  });

const validateChatKey = (c: Context): { key: string; err?: string } => {
  const key = c.req.param("key");
  if (!key) {
    return { key, err: "Key is required" };
  }
  if (key.length > 475) {
    return { key, err: "Key is too long. Max length is 475 characters." };
  }
  return { key };
};

const withChatID = validator("param", (param) => {
  return {
    id: param["id"] as ID,
  };
});

const chat = createRouter()
  // Upsert a chat.
  .post("/:key", async (c) => {
    const { key, err } = validateChatKey(c);
    if (err) {
      return error(c, err);
    }
    return c.json(await c.env.chat.upsert(key), 200);
  })
  .get("/:id", withChatID, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await c.env.chat.get(id), 200);
  })
  .get("/:id/messages", withChatID, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await c.env.chat.getMessages(id), 200);
  })
  // Send messages.
  .post(
    "/:id/sendMessages",
    validator("json", (body) => {
      return {
        id: body["id"] as ID,
        messages: body["messages"] as NewMessage<UIMessage>[],
        options: body["options"] as SendOptions,
      };
    }),
    async (c) => {
      const { id, messages, options } = c.req.valid("json");
      if (!id) {
        return error(c, "ID is required");
      }
      await c.env.chat.sendMessages(id, messages, options);
      return c.body(null, 204);
    }
  )
  .delete(
    "/:id/messages",
    withChatID,
    validator("query", (query) => {
      if (typeof query["message"] === "string") {
        query["message"] = [query["message"]];
      }
      return {
        messages: query["message"] as string[],
      };
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { messages } = c.req.valid("query");
      await c.env.chat.deleteMessages(id, messages);
      return c.body(null, 204);
    }
  )
  .post("/:id/start", withChatID, async (c) => {
    const { id } = c.req.valid("param");
    await c.env.chat.start(id);
    return c.body(null, 204);
  })
  .post("/:id/stop", withChatID, async (c) => {
    const { id } = c.req.valid("param");
    await c.env.chat.stop(id);
    return c.body(null, 204);
  })
  .post("/:id/reset", withChatID, async (c) => {
    const { id } = c.req.valid("param");
    await c.env.chat.reset(id);
    return c.body(null, 204);
  })
  .delete("/:id", withChatID, async (c) => {
    const { id } = c.req.valid("param");
    await c.env.chat.delete(id);
    return c.body(null, 204);
  });

const otlp = createRouter().post("/v1/traces", async (c) => {
  if (!c.env.otlp) {
    // We silently ignore for now - not sure what we should do here it's a Hugo thing.
    return c.body(null, 204);
  }
  return c.env.otlp.traces(c.req.raw);
});

/**
 * To implement your own API bindings, you can use Hono's
 * `createServerAdapter` to create a server that will
 * handle requests to the API.
 *
 * ```ts
 * const server = createHTTPServer(
 *   createServerAdapter((req) => {
 *     return api.fetch(req, <your-bindings>);
 *   })
 * );
 * server.listen(options.port);
 * ```
 */
export const api = new Hono<{
  Bindings: {
    chat: AgentChat;
    store: AgentStore;
    otlp: AgentOtel;
  };
}>()
  // Catch all errors and return a nicer response.
  .onError((err, c) => {
    return c.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  })
  .route("/kv", kv)
  .route("/chat", chat)
  .route("/otlp", otlp);
