import {
  instrument,
  instrumentDO,
  type ConfigurationOption,
  type TraceConfig,
} from "@microlabs/otel-cf-workers";
import { trace } from "@opentelemetry/api";
import { AgentDeployment as BaseAgentDeployment } from "./agent-deployment";
import { Chat as BaseChat } from "./chat";
import { CommandLineAuth as BaseCommandLineAuth } from "./command-line-auth";
import { Workspace as BaseWorkspace } from "./workspace";

/// The purpose of withTraceHeader is to pass trace details to the
/// tail-worker when a handler fails. It lets us associate an exception
/// log with the trace details.
function withTraceHeader(resp: Response): Response {
  try {
    const sc = trace.getActiveSpan()?.spanContext();
    if (sc && sc.traceId && sc.spanId) {
      const h = new Headers(resp.headers);
      if (!h.has("traceparent")) {
        // Use W3C Trace Context traceparent header format:
        // https://www.w3.org/TR/trace-context/#traceparent-header
        const sampled = (sc.traceFlags & 0x1) === 1 ? "01" : "00";
        const tp = `00-${sc.traceId}-${sc.spanId}-${sampled}`;
        h.set("traceparent", tp);
        return new Response(resp.body, { status: resp.status, headers: h });
      }
    }
  } catch {}
  return resp;
}

const createTraceConfig = (service: string): ConfigurationOption => {
  return (env: Env): TraceConfig => {
    const endpoint = env.OTLP_HTTP_TRACES_ENDPOINT;
    const headerAuth = env.OTLP_HTTP_HEADER_AUTHORIZATION;
    if (!endpoint) {
      return {
        exporter: {
          export: (_spans, resultCallback) => {
            resultCallback({ code: 0 });
          },
          shutdown: () => Promise.resolve(),
        },
        fetch: {
          // See the comment below
          includeTraceContext: false,
        },
        service: { name: "blink-worker" },
      } satisfies TraceConfig;
    }
    return {
      exporter: {
        url: endpoint,
        headers: headerAuth ? { Authorization: headerAuth } : undefined,
      },
      fetch: {
        // When our code self-fetches, the inner handler runs in the same isolate and shares the same traceId.
        // When the inner handler exits, it calls forceFlush(traceId); any outer spans that are still running for that same traceId get force-ended.
        // https://github.com/evanderkoogh/otel-cf-workers/blob/effeb549f0a4ed1c55ea0c4f0d8e8e37e5494fb3/src/instrumentation/common.ts#L54
        // https://github.com/evanderkoogh/otel-cf-workers/blob/effeb549f0a4ed1c55ea0c4f0d8e8e37e5494fb3/src/spanprocessor.ts#L114
        // https://github.com/evanderkoogh/otel-cf-workers/blob/effeb549f0a4ed1c55ea0c4f0d8e8e37e5494fb3/src/spanprocessor.ts#L58
        // This produces "span ... not ended properly" logs. It's a bug in the otel-cf-workers library.
        // We disable fetch trace context propagation to avoid this.
        includeTraceContext: false,
      },
      service: {
        name: service,
        namespace: env.NODE_ENV === "development" ? "worker-dev" : "worker",
      },
    } satisfies TraceConfig;
  };
};

export const Workspace = instrumentDO(
  BaseWorkspace,
  createTraceConfig("workspace")
) as unknown as BaseWorkspace;
export const CommandLineAuth = instrumentDO(
  BaseCommandLineAuth,
  createTraceConfig("command-line-auth")
);
export const Chat = instrumentDO(BaseChat, createTraceConfig("chat"));
export const AgentDeployment = instrumentDO(
  BaseAgentDeployment,
  createTraceConfig("agent-deployment")
);

// Route handlers are dynamically imported to keep the cold path minimal.
type RouteHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext
) => Promise<Response> | Response;

export default instrument(
  {
    // This is the main entrypoint for the worker.
    // We handle all routes here.
    fetch: async (req: Request, env: Env, ctx: ExecutionContext) => {
      const url = new URL(req.url);

      let handler: RouteHandler | undefined;

      if (url.pathname.startsWith("/static/")) {
        const id = url.pathname.split("/").pop();
        if (!id) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/api/files/${id}`,
          },
        });
      }

      // For now, flag when we do this.
      if (
        url.pathname === "/api" ||
        url.pathname.startsWith("/api/files") ||
        url.pathname.startsWith("/api/auth") ||
        url.pathname.startsWith("/api/users") ||
        url.pathname.startsWith("/api/organizations") ||
        url.pathname.startsWith("/api/invites") ||
        url.pathname.startsWith("/api/chats") ||
        url.pathname.startsWith("/api/messages") ||
        url.pathname.startsWith("/api/agents") ||
        url.pathname.startsWith("/api/webhook") ||
        url.pathname.startsWith("/api/devhook") ||
        url.pathname.startsWith("/api/ai-gateway") ||
        url.pathname.startsWith("/api/tools") ||
        url.pathname.startsWith("/api/onboarding") ||
        url.host.endsWith(".blink.host") ||
        url.pathname.startsWith("/api/otlp")
      ) {
        return (await import("./new-api")).default(req, env, ctx);
      }

      switch (url.pathname) {
        case "/api/connect-token":
          handler = (await import("./api/connect-token")).default;
          break;
        case "/api/connect-client":
          handler = (await import("./api/connect-client")).default;
          break;
        case "/api/connect":
          handler = (await import("./api/connect")).default;
          break;
      }

      if (handler) {
        return withTraceHeader(await handler(req, env, ctx));
      }

      return withTraceHeader(new Response("Not found", { status: 404 }));
    },
  },
  createTraceConfig("worker")
);
