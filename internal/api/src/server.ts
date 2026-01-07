import Querier from "@blink.so/database/querier";
import type { AgentDeployment, DBMessage } from "@blink.so/database/schema";
import type { AgentStore } from "blink";
import { type ExecutionContext, Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { validate } from "uuid";
import { ZodError } from "zod";
import { fromError } from "zod-validation-error";
import type { CreateChatMessage } from "./client.browser";
import handleAgentRequest from "./routes/agent-request.server";
import mountAgents from "./routes/agents/agents.server";
import type { AgentLog } from "./routes/agents/logs.client";
import type { FieldFilterGroup } from "./routes/agents/traces.client";
import mountAuth from "./routes/auth/auth.server";
import mountChats from "./routes/chats/chats.server";
import mountDevhook from "./routes/devhook.server";
import mountFiles from "./routes/files.server";
import mountInvites from "./routes/invites.server";
import mountMessages from "./routes/messages.server";
import mountOrganizations from "./routes/organizations/organizations.server";
import type { OtelSpan } from "./routes/otlp/convert";
import mountOtlp from "./routes/otlp/otlp.server";
import mountTools from "./routes/tools/tools.server";
import mountUsers from "./routes/users.server";

export type Email =
  | {
      type: "verification";
      email: string;
      name: string | null;
      code: string;
    }
  | {
      type: "password-reset";
      email: string;
      name: string | null;
      code: string;
    }
  | {
      type: "invite";
      email: string;
      inviterName: string;
      inviterEmail: string;
      teamName: string;
      role: string;
      inviteUrl: string;
    };

export type TelemetryEvent =
  | {
      type: "user.registered";
      userId: string;
      email: string | null;
      name: string | null;
      earlyAccess?: boolean;
      createdAt?: string;
    }
  | {
      type: "user.oauth_registered";
      userId: string;
      email: string | null;
      name: string | null;
      provider: string;
      createdAt?: string;
    }
  | {
      type: "user.invited";
      email: string;
      role?: string;
      invitedAt?: string;
      inviteCode?: string;
    }
  | {
      type: "user.merged";
      primaryUserId: string;
      secondaryUserId: string;
    }
  | {
      type: "user.deleted";
      userId: string;
    };

export interface Bindings {
  readonly database: () => Promise<Querier>;
  readonly agentStore: (targetID: string) => AgentStore;
  readonly auth: {
    // handleWebSocketTokenRequest is a function that will be called
    // when a WebSocket connection is inbound for a token request.
    //
    // This is abstracted so the Cloudflare or Node implementation work regardless.
    readonly handleWebSocketTokenRequest: (
      id: string,
      request: Request
    ) => Promise<Response>;

    /**
     * sendTokenToWebSocket is called when the user has authenticated with the respective
     * authentication ID and we now have a token.
     *
     * It's expected that the implementor would send the token to the WebSocket
     * connection.
     *
     * @param id - The authentication ID.
     * @param token - The token.
     * @returns - A promise that resolves when the token has been handled.
     */
    readonly sendTokenToWebSocket: (id: string, token: string) => Promise<void>;
  };
  readonly files: {
    readonly upload: (opts: {
      user_id?: string;
      agent_id?: string;
      organization_id?: string;
      file: File;
    }) => Promise<{
      id: string;
      url: string;
    }>;
    readonly download: (id: string) => Promise<{
      stream: ReadableStream;
      type: string;
      name: string;
      size: number;
    }>;
  };
  readonly chat: {
    readonly handleStart: (opts: {
      id: string;
      interrupt: boolean;
    }) => Promise<void>;
    readonly handleStop: (id: string) => Promise<void>;
    readonly handleStream: (id: string, req: Request) => Promise<Response>;
    readonly handleMessagesChanged: (
      event: "message.created" | "message.updated",
      id: string,
      messages: DBMessage[]
    ) => Promise<void>;
    // This is intended to be an async operation where the server
    // will notify the clients by some means that the title has been generated.
    readonly generateTitle?: (opts: {
      messages: CreateChatMessage[];
      id: string;
    }) => void;
  };
  readonly logs: {
    readonly get: (opts: {
      agent_id: string;
      /**
       * Simple filter - supports literal matching and wildcard matching.
       * Wildcard matching is done using the `*` character. The '*' characters can be escaped with a backslash.
       * For example:
       * - `*error*` will match any message that contains the word "error".
       * - `error*` will match any message that starts with the word "error".
       * - `*error` will match any message that ends with the word "error".
       * - `*error*success` will match any message that contains the word "error" and ends with "success".
       * - `error\*` will match any message that contains the literal string "error*".
       */
      message_pattern?: string;
      /**
       * Advanced filters - same as traces filtering.
       * Allows filtering by JSON paths in the log payload.
       */
      filters?: FieldFilterGroup;
      start_time: Date;
      end_time: Date;
      limit: number;
    }) => Promise<AgentLog[]>;
    readonly write: (opts: {
      agent_id: string;
      event: Record<string, unknown>;
    }) => Promise<void>;
  };
  readonly compute?: {
    readonly handleConnect: (id: string, req: Request) => Promise<Response>;
    readonly handleServe: (id: string, req: Request) => Promise<Response>;
  };
  readonly traces: {
    readonly write: (spans: OtelSpan[]) => Promise<void>;
    readonly read: (opts: {
      agent_id: string;
      filters: FieldFilterGroup;
      start_time?: Date;
      end_time?: Date;
      limit: number;
    }) => Promise<OtelSpan[]>;
  };
  readonly runtime: {
    readonly usage: (opts: {
      agent_id: string;
      start_time: Date;
      end_time: Date;
    }) => Promise<string>;
  };
  readonly devhook?: {
    readonly handleListen: (id: string, req: Request) => Promise<Response>;
    readonly handleRequest: (id: string, req: Request) => Promise<Response>;
  };
  readonly sendEmail?: (email: Email) => Promise<void>;
  readonly sendTelemetryEvent?: (event: TelemetryEvent) => Promise<void>;
  /**
   * Deploy an agent. It's expected that the implementor will update the status
   * of the deployment as it progresses, and will mark it as the "active_deployment_id"
   * if the "target" is "production".
   *
   * @param deployment - The agent deployment to deploy.
   * @returns - A promise that resolves when the agent has been deployed.
   */
  readonly deployAgent: (deployment: AgentDeployment) => Promise<void> | void;

  /**
   * apiBaseURL is the base URL that the API is running on.
   * Pathname will not be respected - /api is used.
   */
  readonly apiBaseURL: URL;
  readonly matchRequestHost?: (host: string) => string | undefined;
  readonly createRequestURL?: (id: string) => URL;

  readonly AUTH_SECRET: string;
  readonly NODE_ENV: string;
  readonly AI_GATEWAY_API_KEY?: string;
  readonly TOOLS_EXA_API_KEY?: string;

  // OAuth provider credentials
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;

  // Optional AWS credentials used by platform logging to CloudWatch
  readonly AWS_ACCESS_KEY_ID?: string;
  readonly AWS_SECRET_ACCESS_KEY?: string;
  readonly AWS_REGION?: string;
}

export type APIServer = Hono<{
  Bindings: Bindings;
}>;

const api = new Hono<{
  Bindings: Bindings;
}>()
  .basePath("/api")
  .use(async (c, next) => {
    // Skip CORS middleware for webhook routes - they handle their own CORS filtering
    // to preserve non-CORS Vary header values from agents
    if (c.req.path.startsWith("/api/webhook/")) {
      return next();
    }
    return cors({
      // We're going to test the embedding of chats on coder.com.
      origin: ["https://blink.coder.com"],
    })(c, next);
  });

api.use(async (c, next) => {
  await next();
  if (c.res.headers.get("Content-Type")?.startsWith("application/json")) {
    const obj = await c.res.json();
    c.res = new Response(JSON.stringify(obj, null, 2), c.res);
  }
});
api.get("/", async (c) => {
  return c.json({
    message: "Hello, world!",
  });
});
api.onError((err, c) => {
  console.error(err);

  if (err instanceof ZodError) {
    const parsed = fromError(err);
    return c.json(
      {
        message: fromError(err).message,
        details: parsed.details,
      },
      400
    );
  }

  if (err instanceof HTTPException) {
    return c.json(
      {
        message: err.message,
        details: err.cause,
      },
      err.status
    );
  }

  return c.json(
    {
      message: "Internal Server Error",
    },
    500
  );
});
api.notFound((c) => {
  return c.json({ message: "Not Found" }, 404);
});

mountAgents(api.basePath("/agents"));
mountAuth(api.basePath("/auth"));
mountChats(api.basePath("/chats"));
mountFiles(api.basePath("/files"));
mountOrganizations(api.basePath("/organizations"));
mountUsers(api.basePath("/users"));
mountInvites(api.basePath("/invites"));
mountMessages(api.basePath("/messages"));
mountTools(api.basePath("/tools"));
mountOtlp(api.basePath("/otlp"));
mountDevhook(api.basePath("/devhook"));

// Webhook route for proxying requests to agents
// The wildcard route handles subpaths like /api/webhook/:id/github/events
api.all("/webhook/:id{.*}", async (c) => {
  // Extract id and subpath from the matched param
  const fullParam = c.req.param("id");
  const slashIndex = fullParam.indexOf("/");
  const id = slashIndex === -1 ? fullParam : fullParam.slice(0, slashIndex);
  const subpath = slashIndex === -1 ? "" : fullParam.slice(slashIndex);

  if (!validate(id)) {
    return c.json({ message: "Invalid ID" }, 400);
  }
  return handleAgentRequest(c, id, { mode: "webhook", subpath });
});

export type AgentServer = Hono<{
  Bindings: Bindings;
  Variables: {
    request_id: string;
  };
}>;

const app = new Hono<{
  Bindings: Bindings;
}>();
app.all("*", (c) => {
  const url = new URL(c.req.raw.url);
  const match = c.env.matchRequestHost && c.env.matchRequestHost(url.host);
  // We handle all agent requests here if they match.
  // This could be for dev requests or production requests.
  if (match) {
    return handleAgentRequest(c, match, { mode: "subdomain" });
  }
  // Just pass through to the API.
  // We could make it 404 here, but it's really unnecessary
  // it will anyways if the route is not found.
  return api.fetch(c.req.raw, c.env, c.executionCtx);
});

export default {
  fetch: (
    req: Request,
    bindings: Bindings,
    executionCtx?: ExecutionContext
  ) => {
    return app.fetch(req, bindings, executionCtx);
  },
};

export type { OtelSpan };
