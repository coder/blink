import { createGatewayProvider } from "@ai-sdk/gateway";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { createServerAdapter } from "@whatwg-node/server";
import type { InferUIMessageChunk, JSONValue, UIMessage } from "ai";
import { Hono } from "hono";
import { hc } from "hono/client";
import { validator } from "hono/validator";
import * as http from "http";
import type { api as apiServer } from "../control";
import { getAuthToken, runWithAuth } from "../internal/context";
import { CustomChatResponseError } from "./internal/errors";
import type { Promisable } from "./internal/types";
import { flushOtel, otelMiddleware } from "./otel";
import {
  type AgentChat,
  type AgentStore,
  type Chat,
  type ChatHandler,
  type ChatResponse,
  type ID,
  type NewMessage,
  type SendOptions,
  type UpsertedChat,
} from "./types";
import type { UIHandler, UIOptions } from "./ui";

export interface ServeOptions {
  /**
   * apiUrl is the URL of the Blink API server which the agent
   * uses to create chats, send messages, and manage storage.
   *
   * Defaults `BLINK_API_URL`. If not set, the agent will warn
   * and throw an error if a request is attempted to the API.
   */
  apiUrl?: string;

  /**
   * host is the host to serve the agent on.
   *
   * Defaults to `HOST` or `127.0.0.1.
   */
  host?: string;

  /**
   * port is the port to serve the agent on.
   *
   * Defaults to `PORT` or `3000`.
   */
  port?: number;
}

export type RequestHandler = (request: Request) => Promisable<Response | void>;

export type ErrorHandler = (error: Error) => Promisable<Response | void>;

// Event map that ties event names to their handler types
type EventHandlerMap<M extends UIMessage> = {
  chat: ChatHandler<M>;
  ui: UIHandler<M>;
  request: RequestHandler;
  error: ErrorHandler;
};

// Extract valid event names
type EventName<M extends UIMessage> = keyof EventHandlerMap<M>;

// Get the handler type for a specific event
type HandlerForEvent<
  M extends UIMessage,
  E extends EventName<M>,
> = EventHandlerMap<M>[E];

type Listeners<M extends UIMessage> = {
  [E in EventName<M>]: Array<HandlerForEvent<M, E>>;
};

export class Agent<MESSAGE extends UIMessage> {
  private client: ReturnType<typeof hc<typeof apiServer>>;
  private listeners: Listeners<MESSAGE> = {
    chat: [],
    ui: [],
    request: [],
    error: [],
  };

  public constructor() {
    const apiUrl = process.env.BLINK_API_URL;
    this.client = hc<typeof apiServer>(process.env.BLINK_API_URL ?? "", {
      fetch: apiUrl
        ? undefined
        : async () => {
            console.warn(
              "Your code is attempting to use the Blink API server, but no API server is configured for this Blink agent."
            );
            throw new Error(
              "No API server is configured for this Blink agent. External APIs are not available."
            );
          },
    });
  }

  public readonly chat: AgentChat<MESSAGE> = {
    /**
     * Upsert a chat by a stable key.
     * This will create a new chat if it doesn't exist.
     *
     * @param key the key of the chat.
     */
    upsert: async (key: JSONValue): Promise<UpsertedChat> => {
      const response = await this.client.chat[":key"].$post({
        param: {
          key: JSON.stringify(key),
        },
      });
      if (response.status !== 200) {
        throw new Error("Failed to upsert chat!");
      }
      return response.json();
    },

    /**
     * Get a chat by ID.
     *
     * @param id the ID of the chat.
     * @returns the chat.
     */
    get: async (id: ID): Promise<Chat | undefined> => {
      const response = await this.client.chat[":id"].$get({
        param: {
          id,
        },
      });
      if (response.status !== 200) {
        throw new Error("Failed to get chat!");
      }
      return response.json();
    },

    /**
     * Get messages from a chat.
     *
     * @param id the ID of the chat.
     * @returns the messages in the chat.
     */
    getMessages: async (id: ID): Promise<MESSAGE[]> => {
      const response = await this.client.chat[":id"].messages.$get({
        param: {
          id,
        },
      });
      if (response.status !== 200) {
        throw new Error("Failed to get messages!");
      }
      return (await response.json()) as MESSAGE[];
    },

    /**
     * Send messages to a chat.
     *
     * @param id the ID of the chat.
     * @param messages the messages to send.
     * @param options the options for the messages.
     */
    sendMessages: async (
      id: ID,
      messages: NewMessage<MESSAGE>[],
      options?: SendOptions
    ): Promise<void> => {
      const response = await this.client.chat[":id"].sendMessages.$post({
        param: {
          id,
        },
        json: {
          id,
          messages,
          options: options ?? {},
        },
      });
      if (response.status !== 204) {
        throw new Error("Failed to send messages!");
      }
    },

    /**
     * Delete messages from a chat.
     *
     * @param id the ID of the chat.
     * @param messages the messages to delete.
     */
    deleteMessages: async (id: ID, messages: string[]): Promise<void> => {
      // Note: The control API validator expects 'message' (singular) as the query parameter name
      // but can accept a string or array value. Using 'as any' to bypass type checking.
      const response = await this.client.chat[":id"].messages.$delete({
        param: {
          id,
        },
        query: {
          message: messages,
        },
      } as any);
      if (response.status !== 204) {
        throw new Error("Failed to delete messages!");
      }
    },

    /**
     * start a chat. If already started, it will return without error.
     *
     * @param id the ID of the chat.
     */
    start: async (id: ID): Promise<void> => {
      const response = await this.client.chat[":id"].start.$post({
        param: {
          id,
        },
      });
      if (response.status !== 204) {
        throw new Error("Failed to start chat!");
      }
    },

    /**
     * stop a chat. If stopped, it will return without error.
     * @param id
     */
    stop: async (id: ID): Promise<void> => {
      const response = await this.client.chat[":id"].stop.$post({
        param: {
          id,
        },
      });
      if (response.status !== 204) {
        throw new Error("Failed to stop chat!");
      }
    },

    /**
     * delete a chat. If not found, it will return without error.
     *
     * @param id the ID of the chat.
     */
    delete: async (id: ID): Promise<void> => {
      const response = await this.client.chat[":id"].$delete({
        param: {
          id,
        },
      });
      if (response.status !== 204) {
        throw new Error("Failed to delete chat!");
      }
    },
  };

  public readonly store: AgentStore = {
    get: async (key) => {
      const response = await this.client.kv[":key"].$get({
        param: {
          key: encodeURIComponent(key),
        },
      });
      if (response.status !== 200) {
        throw new Error("Failed to get value!");
      }
      const { value } = await response.json();
      return value;
    },
    set: async (key, value) => {
      const response = await this.client.kv[":key"].$post({
        param: {
          key: encodeURIComponent(key),
        },
        json: {
          value,
        },
      });
      if (response.status !== 204) {
        throw new Error("Failed to set value!");
      }
    },
    delete: async (key) => {
      const response = await this.client.kv[":key"].$delete({
        param: {
          key: encodeURIComponent(key),
        },
      });
      if (response.status !== 204) {
        throw new Error("Failed to delete value!");
      }
    },
    list: async (prefix, options) => {
      const response = await this.client.kv.$get({
        query: {
          prefix: prefix ? encodeURIComponent(prefix) : undefined,
          limit: options?.limit,
          cursor: options?.cursor,
        },
      });
      if (response.status !== 200) {
        throw new Error("Failed to list values!");
      }
      return response.json();
    },
  };

  public on<E extends EventName<MESSAGE>>(
    event: E,
    handler: HandlerForEvent<MESSAGE, E>
  ): Agent<MESSAGE> {
    this.listeners[event] = [...(this.listeners[event] ?? []), handler] as any;
    return this;
  }

  /**
   * serve starts the agent as an HTTP server.
   * @param options
   * @returns
   */
  public serve(options?: ServeOptions): http.Server {
    if (!options) {
      options = {};
    }
    if (!options.host) {
      options.host = process.env.HOST ?? "127.0.0.1";
    }
    if (!options.port) {
      options.port = parseInt(process.env.PORT ?? "3000");
    }
    if (options.apiUrl) {
      this.client = hc<typeof apiServer>(options.apiUrl);
    }

    const server = http.createServer(
      createServerAdapter((req) => {
        return this.fetch(req);
      })
    );
    return server.listen(options?.port ?? 3000, options?.host ?? "127.0.0.1");
  }

  /**
   * fetch fetches from the agent.
   * @param request
   * @returns
   */
  public fetch(request: Request) {
    // Read auth token from request header (set by the wrapper's proxy).
    // Set up AsyncLocalStorage context so internal API calls have access to the token.
    const authToken = request.headers.get("x-blink-internal-auth");
    if (authToken) {
      return runWithAuth(authToken, () =>
        api.fetch(request, { listeners: this.listeners })
      );
    }
    return api.fetch(request, {
      listeners: this.listeners,
    });
  }
}

/**
 * agent constructs a new agent.
 *
 * @deprecated Use `new Agent()` instead.
 * @param options
 * @returns
 */
export function agent<MESSAGE extends UIMessage>(): Agent<MESSAGE> {
  return new Agent<MESSAGE>();
}

// If you open a pull request, you'd store something with:
// `agent.store.set("github-pr-${pr.node_id}", id);`

export const api = new Hono<{
  Bindings: {
    listeners: Listeners<any>;
  };
}>()
  .use(otelMiddleware)
  .post(
    "/_agent/chat",
    validator("json", (body) => {
      return {
        messages: body.messages as UIMessage[],
        id: body.id as ID,
      };
    }),
    async (c) => {
      const handlers = c.env.listeners.chat;
      const req = c.req.valid("json");
      for (const handler of handlers) {
        let result: ChatResponse<any>;
        try {
          result = await handler({
            id: req.id,
            messages: req.messages,
            abortSignal: c.req.raw.signal,
          });
        } catch (err) {
          if (err instanceof CustomChatResponseError) {
            result = err.response;
          } else {
            throw err;
          }
        }

        if (!result) {
          continue;
        }
        if (result instanceof Response) {
          return result;
        }

        let stream: ReadableStream<InferUIMessageChunk<UIMessage>>;
        if (result instanceof ReadableStream) {
          stream = result;
        } else if (
          typeof result === "object" &&
          "toUIMessageStream" in result
        ) {
          stream = result.toUIMessageStream({
            // Send model usage metadata back to Blink by default.
            messageMetadata: ({ part }) => {
              switch (part.type) {
                case "finish":
                  return {
                    totalUsage: part.totalUsage,
                  };
                case "finish-step":
                  return {
                    usage: part.usage,
                    model: part.response.modelId,
                  };
              }
            },
          });
        } else {
          throw new Error(
            "Invalid chat handler result! Must be a Response, ReadableStream, or toUIMessageStream function."
          );
        }

        return new Response(
          stream
            .pipeThrough(
              new TransformStream<unknown, string>({
                transform(chunk, controller) {
                  controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
                },
                flush(controller) {
                  controller.enqueue("data: [DONE]\n\n");
                },
              })
            )
            .pipeThrough(new TextEncoderStream()),
          {
            headers: sseHeaders,
          }
        );
      }
      return c.json(
        {
          error: "No chat handlers found.",
        },
        404
      );
    }
  )
  .get("/_agent/capabilities", async (c) => {
    const handlers = c.env.listeners;
    const capabilities = {
      ui: handlers.ui.length > 0,
      chat: handlers.chat.length > 0,
      request: handlers.request.length > 0,
      error: handlers.error.length > 0,
    };
    return c.json(capabilities, 200);
  })
  .get("/_agent/health", async (c) => {
    return c.body("OK", 200);
  })
  .get("/_agent/ui", async (c) => {
    const selectedOptionsRaw = c.req.query("selected_options");
    let selectedOptions: UIOptions | undefined;
    if (selectedOptionsRaw) {
      try {
        selectedOptions = JSON.parse(selectedOptionsRaw);
      } catch (err) {
        return c.json(
          {
            error: "Invalid selected_options query parameter!",
          },
          400
        );
      }
    }

    const handlers = c.env.listeners.ui;
    for (const handler of handlers) {
      const result = await handler({
        selectedOptions,
      });
      if (!result) {
        continue;
      }
      return c.json(result, 200);
    }
    return c.json({ error: "No UI listener returned a response" }, 404);
  })
  .post("/_agent/flush-otel", async (c) => {
    await flushOtel();
    return c.body(null, 204);
  })
  .all("*", async (c) => {
    const handlers = c.env.listeners.request;
    for (const handler of handlers) {
      const result = await handler(c.req.raw);
      if (result) {
        return result;
      }
    }
    return c.json({ error: "No request handlers found." }, 404);
  })
  .onError((err, c) => {
    console.error("Agent error:", err);
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(err);
      activeSpan.setStatus({ code: SpanStatusCode.ERROR });
    }
    return c.json({ error: "Internal server error" }, 500);
  });

const sseHeaders = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no", // disable nginx buffering
};

/**
 * model returns an AI-SDK model provider that can be
 * used with `streamText`, `generateText`, etc.
 *
 * It simply proxies to the Vercel AI Gateway, with no
 * additional cost.
 *
 * Find model names at: https://vercel.com/ai-gateway/models.
 *
 * Common:
 * "anthropic/claude-sonnet-4.5"
 * "anthropic/claude-sonnet-4"
 * "openai/gpt-5"
 *
 * @param model the model name. browse models at: https://vercel.com/ai-gateway/models.
 */
const model = (model: string, options?: { token?: string }) => {
  // This bypass is *ONLY* for temporary testing
  // until we fix the onboarding flow.
  const token =
    options?.token ?? process.env.BLINK_TOKEN ?? getAuthToken() ?? "fake-key";
  //   if (!token) {
  //     throw new Error(`You must be authenticated with Blink to use the model gateway.

  // Authenticate with "blink login".

  // Feel free to use other providers like OpenAI, Anthropic, or Google.`);
  //   }

  const baseURL =
    process.env.INTERNAL_BLINK_API_SERVER_URL ?? "https://blink.coder.com";
  const gatewayURL = new URL("/api/ai-gateway/v1/ai", baseURL);

  return createGatewayProvider({
    baseURL: gatewayURL.toString(),
    apiKey: token,
  })(model);
};

// Internal: Used for injecting waitUntil in the runtime.
const waitUntilSymbol = Symbol.for("@blink/waitUntil");

/**
 * waitUntil waits until the promise is resolved.
 * This is useful for responding quickly in webhooks, but
 * allow processing to continue in the background.
 */
export function waitUntil<T>(promise: Promise<T>): void {
  // @ts-expect-error
  const waitUntil = globalThis[waitUntilSymbol];
  if (waitUntil) {
    waitUntil(promise);
  }
}
