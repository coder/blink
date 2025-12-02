// Billing stubs - OSS version doesn't track usage
class Money {
  private constructor(private value: string) {}
  static from(value: string | number): Money {
    return new Money(String(value));
  }
  toString(): string {
    return this.value;
  }
}
type EnvLike = unknown;
async function ingestUsageEvent(
  _env: EnvLike,
  _querier: unknown,
  _opts: unknown
): Promise<void> {
  // No-op in OSS version
}
import type Querier from "@blink.so/database/querier";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { z } from "zod";
import type { APIServer } from "../server";
import { withToolsAuth } from "./tools/tools.server";

const UpstreamRequestSchema = z.looseObject({
  stream: z.boolean().optional(),
  stream_options: z
    .object({
      include_usage: z.boolean().optional(),
    })
    .optional(),
});

const StreamingChunkSchema = z.looseObject({
  choices: z.array(
    z.object({
      delta: z.object({
        provider_metadata: z.object({
          gateway: z.object({
            cost: z.string(),
          }),
        }),
      }),
    })
  ),
});

const LanguageModelFinishChunkSchema = z.looseObject({
  type: z.literal("finish"),
  providerMetadata: z.object({
    gateway: z.object({
      cost: z.string(),
    }),
  }),
});

const NonStreamingResponseSchema = z.looseObject({
  choices: z
    .array(
      z.object({
        message: z.object({
          provider_metadata: z.object({
            gateway: z.object({ cost: z.string() }),
          }),
        }),
      })
    )
    .optional(),
});

const VERCEL_AI_GATEWAY_URL = "https://ai-gateway.vercel.sh";

function createGatewayUrl(path: string[]): string {
  return `${VERCEL_AI_GATEWAY_URL}/${path.join("/")}`;
}

function extractCostFromStreamingChunk(obj: unknown): Money | undefined {
  // Try language model format first (type: "finish")
  const languageModelParsed = LanguageModelFinishChunkSchema.safeParse(obj);
  if (languageModelParsed.success) {
    const cost = languageModelParsed.data.providerMetadata?.gateway?.cost;
    if (cost) {
      return Money.from(cost);
    }
  }

  // Try chat completions format
  const parsed = StreamingChunkSchema.safeParse(obj);
  if (!parsed.success) {
    return undefined;
  }
  const data = parsed.data;
  if (!data.choices) {
    return undefined;
  }
  for (const choice of data.choices) {
    // https://vercel.com/docs/ai-gateway/provider-options#example-provider-metadata-output
    // > The gateway.cost value is the amount debited from your AI Gateway Credits balance for
    // > this request. It is returned as a decimal string.
    const cost = choice?.delta?.provider_metadata?.gateway?.cost;
    if (!cost) {
      continue;
    }
    return Money.from(cost);
  }

  return undefined;
}

function extractCostFromNonStreamingResponse(obj: unknown): Money | undefined {
  // Try language model format first (has providerMetadata at top level)
  const languageModelParsed = LanguageModelFinishChunkSchema.safeParse(obj);
  if (languageModelParsed.success) {
    const cost = languageModelParsed.data.providerMetadata?.gateway?.cost;
    if (cost) {
      return Money.from(cost);
    }
  }

  // Try chat completions format
  const parsed = NonStreamingResponseSchema.safeParse(obj);
  if (!parsed.success) {
    console.warn("Invalid non-streaming chunk:", obj);
    return undefined;
  }
  const data = parsed.data;
  if (!data.choices) {
    return undefined;
  }
  for (const choice of data.choices) {
    const cost = choice?.message?.provider_metadata?.gateway?.cost;
    if (!cost) {
      continue;
    }
    return Money.from(cost);
  }
  return undefined;
}

async function recordBilling(
  env: EnvLike,
  querier: Querier,
  opts: {
    organizationId: string;
    userId?: string;
    cost: Money;
  }
) {
  try {
    const usageEvent = await ingestUsageEvent(env, querier, {
      organizationId: opts.organizationId,
      costUSD: opts.cost,
      transactionId: `proxy-${crypto.randomUUID()}`,
      eventType: "language_model",
      userID: opts.userId,
    });
  } catch (error) {
    console.error("Failed to record billing to Metronome for LLM usage", error);
  }
}

function createResponseHeaders(contentType: string): Headers {
  const headers = new Headers();
  headers.set("content-type", contentType);
  return headers;
}

export function mountDisabledAIGateway(server: APIServer) {
  server.all("*", async (c) => {
    return c.json({ error: "Service unavailable" }, 503);
  });
}

function mountAIGateway(server: APIServer) {
  // GET /api/ai-gateway/v1/models
  server.get("/v1/models", async (_c) => {
    const upstream = await fetch(createGatewayUrl(["v1", "models"]), {
      method: "GET",
      headers: {
        "content-type": "application/json",
      },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: createResponseHeaders("application/json"),
    });
  });
  // GET /api/ai-gateway/v1/models/*
  server.get("/v1/models/*", async (c) => {
    const rest = c.req.path.split("/v1/models/")[1] ?? "";
    const upstream = await fetch(createGatewayUrl(["v1", "models", rest]), {
      method: "GET",
      headers: {
        "content-type": "application/json",
      },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: createResponseHeaders("application/json"),
    });
  });

  // POST /api/ai-gateway/v1/chat/completions
  // The tools auth allows us to let an agent or a user invoke this endpoint.
  server.post("/v1/chat/completions", withToolsAuth(), async (c) => {
    if (!c.env.AI_GATEWAY_API_KEY) {
      console.error("AI_GATEWAY_API_KEY is not set");
      return c.json({ error: "Service unavailable" }, 503);
    }

    let organizationID: string | undefined;
    const db = await c.env.database();
    if (c.get("agent_id")) {
      const agent = await db.selectAgentByID(c.get("agent_id")!);
      if (agent) {
        organizationID = agent.organization_id;
      }
    } else {
      const userID = c.get("user_id");
      if (userID) {
        const user = await db.selectUserByID(userID);
        if (user) {
          // TODO: This should be configured by the user,
          // but for now since all is free, it's fine.
          organizationID = user.organization_id;
        }
      }
    }

    if (!organizationID) {
      return c.json({ error: "Organization not found" }, 404);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid payload" }, 400);
    }

    const parsedIn = UpstreamRequestSchema.safeParse(payload);
    if (!parsedIn.success) {
      return c.json({ error: "Invalid payload" }, 400);
    }
    const normalized = parsedIn.data;
    if (normalized?.stream === true) {
      normalized.stream_options = {
        ...(normalized.stream_options ?? {}),
        include_usage: true,
      };
    }

    const upstream = await fetch(
      createGatewayUrl(["v1", "chat", "completions"]),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${c.env.AI_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify(normalized),
      }
    );

    // Non-streaming response
    if (!normalized?.stream) {
      const json = await upstream.json().catch(() => ({}));
      const cost = extractCostFromNonStreamingResponse(json);
      if (cost != null) {
        await recordBilling(c.env, db, {
          organizationId: organizationID,
          userId: c.get("user_id"),
          cost,
        });
      } else {
        console.warn(
          "LLM cost not available. The user will not be billed for this request.",
          json
        );
      }
      return new Response(JSON.stringify(json), {
        status: upstream.status,
        headers: createResponseHeaders("application/json"),
      });
    }

    const body = upstream.body;
    if (!body) {
      return c.json({ error: "Upstream returned no body" }, 502);
    }

    const [toClient, toLog] = body.tee();

    (async () => {
      try {
        let lastCost: Money | undefined;
        const decoder = new TextDecoder();
        const parser = createParser({
          onEvent: (evt: EventSourceMessage) => {
            const data = evt.data;
            if (!data || data === "[DONE]") {
              return;
            }
            try {
              const json = JSON.parse(data);
              const cost = extractCostFromStreamingChunk(json);
              if (cost != null) {
                lastCost = cost;
              }
            } catch {
              console.warn("Malformed JSON chunk:", data);
            }
          },
        });

        const reader = toLog.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          parser.feed(decoder.decode(value, { stream: true }));
        }

        if (lastCost != null) {
          await recordBilling(c.env, db, {
            organizationId: organizationID,
            userId: c.get("user_id"),
            cost: lastCost,
          });
        } else {
          console.warn(
            "LLM cost not available. The user will not be billed for this request."
          );
        }
      } catch (err) {
        console.error("Failed to parse SSE for cost:", err);
      }
    })();

    // For streaming responses, determine content type from upstream
    const streamingHeaders = createResponseHeaders(
      upstream.headers.get("content-type") ?? "text/event-stream"
    );
    streamingHeaders.set("cache-control", "no-cache");

    return new Response(toClient, {
      status: upstream.status,
      headers: streamingHeaders,
    });
  });

  // POST /api/ai-gateway/v1/ai/language-model
  // Language Model API endpoint (AI SDK v5 protocol)
  server.post("/v1/ai/language-model", async (c) => {
    if (!c.env.AI_GATEWAY_API_KEY) {
      console.error("AI_GATEWAY_API_KEY is not set");
      return c.json({ error: "Service unavailable" }, 503);
    }

    try {
      // This is GIGA JANK to allow users to unauthenticated
      // use our model gateway right now. This is *just*
      // to allow the Cloudflare team to test the CLI/Edit mode
      // without needing auth.
      await withToolsAuth()(c as any, async () => {});
    } catch (err) {
      //
    }

    // @ts-expect-error
    const agentID = c.get("agent_id")! as string | undefined;
    // @ts-expect-error
    const userID = c.get("user_id")! as string | undefined;

    let organizationID: string | undefined;
    const db = await c.env.database();
    if (agentID) {
      const agent = await db.selectAgentByID(agentID);
      if (agent) {
        organizationID = agent.organization_id;
      }
    } else {
      if (userID) {
        const user = await db.selectUserByID(userID);
        if (user) {
          organizationID = user.organization_id;
        }
      }
    }

    if (!organizationID) {
      organizationID = "9d2cef66-36eb-4a32-bd83-e5aca9f993ee";

      // TODO: Remove this once we open auth.
      // return c.json({ error: "Organization not found" }, 404);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid payload" }, 400);
    }

    // Extract headers for the language model API
    const modelId = c.req.header("ai-language-model-id");
    const streaming = c.req.header("ai-language-model-streaming") === "true";
    const specVersion = c.req.header("ai-language-model-specification-version");
    const authMethod = c.req.header("ai-gateway-auth-method");
    const protocolVersion = c.req.header("ai-gateway-protocol-version");

    // Forward headers to Vercel AI Gateway
    const upstreamHeaders: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${c.env.AI_GATEWAY_API_KEY}`,
    };

    if (modelId) upstreamHeaders["ai-language-model-id"] = modelId;
    if (specVersion)
      upstreamHeaders["ai-language-model-specification-version"] = specVersion;
    if (authMethod) upstreamHeaders["ai-gateway-auth-method"] = authMethod;
    if (protocolVersion)
      upstreamHeaders["ai-gateway-protocol-version"] = protocolVersion;
    upstreamHeaders["ai-language-model-streaming"] = streaming
      ? "true"
      : "false";

    if (modelId && modelId.startsWith("anthropic/")) {
      // We automatically add caching for Anthropic models.
      // It's only enabled if the user has no provider options set.
      applyCachingForAnthropic(payload);
    }

    const upstream = await fetch(
      createGatewayUrl(["v1", "ai", "language-model"]),
      {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(payload),
      }
    );

    // Non-streaming response
    if (!streaming) {
      const json = await upstream.json().catch(() => ({}));
      const cost = extractCostFromNonStreamingResponse(json);
      if (cost != null) {
        await recordBilling(c.env, db, {
          organizationId: organizationID,
          userId: userID,
          cost,
        });
      } else {
        console.warn(
          "LLM cost not available. The user will not be billed for this request.",
          json
        );
      }
      return new Response(JSON.stringify(json), {
        status: upstream.status,
        headers: createResponseHeaders("application/json"),
      });
    }

    const body = upstream.body;
    if (!body) {
      return c.json({ error: "Upstream returned no body" }, 502);
    }

    const [toClient, toLog] = body.tee();

    (async () => {
      try {
        let lastCost: Money | undefined;
        const decoder = new TextDecoder();
        const parser = createParser({
          onEvent: (evt: EventSourceMessage) => {
            const data = evt.data;
            if (!data || data === "[DONE]") {
              return;
            }
            try {
              const json = JSON.parse(data);
              const cost = extractCostFromStreamingChunk(json);
              if (cost != null) {
                lastCost = cost;
              }
            } catch {
              console.warn("Malformed JSON chunk:", data);
            }
          },
        });

        const reader = toLog.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          parser.feed(decoder.decode(value, { stream: true }));
        }

        if (lastCost != null) {
          await recordBilling(c.env, db, {
            organizationId: organizationID,
            userId: userID,
            cost: lastCost,
          });
        } else {
          console.warn(
            "LLM cost not available. The user will not be billed for this request."
          );
        }
      } catch (err) {
        console.error("Failed to parse SSE for cost:", err);
      }
    })();

    // For streaming responses, determine content type from upstream
    const streamingHeaders = createResponseHeaders(
      upstream.headers.get("content-type") ?? "text/event-stream"
    );
    streamingHeaders.set("cache-control", "no-cache");

    return new Response(toClient, {
      status: upstream.status,
      headers: streamingHeaders,
    });
  });
}

const applyCachingForAnthropic = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return;
  }
  if (!("prompt" in body)) {
    return;
  }
  if (!Array.isArray(body.prompt)) {
    return;
  }
  const prompt = body.prompt;
  let hasCaching = false;
  let lastSystemMessage: any | undefined;
  for (const message of prompt) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.role === "system") {
      lastSystemMessage = message;
    }
    if (
      "providerOptions" in message &&
      typeof message.providerOptions === "object"
    ) {
      if (
        "anthropic" in message.providerOptions &&
        typeof message.providerOptions.anthropic === "object"
      ) {
        if (
          "cacheControl" in message.providerOptions.anthropic &&
          typeof message.providerOptions.anthropic.cacheControl === "object"
        ) {
          hasCaching = true;
        }
      }
    }
  }
  if (hasCaching) {
    return;
  }

  const applyCaching = (message: any) => {
    if (typeof message !== "object") {
      return;
    }
    const providerOptions = message.providerOptions ?? {};
    if (typeof providerOptions !== "object") {
      return;
    }
    message.providerOptions = providerOptions;
    const anthropic = providerOptions.anthropic ?? {};
    if (typeof anthropic !== "object") {
      return;
    }
    providerOptions.anthropic = anthropic;
    const cacheControl = anthropic.cacheControl ?? {};
    if (typeof cacheControl !== "object") {
      return;
    }
    anthropic.cacheControl = cacheControl;
    cacheControl.type = "ephemeral";
  };

  // We cache the last system message, and the last user message.
  if (lastSystemMessage) {
    applyCaching(lastSystemMessage);
  }
  const lastMessage = prompt[prompt.length - 1];
  if (lastMessage) {
    applyCaching(lastMessage);
  }
};
