import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter as OTLPHttpTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { MiddlewareHandler } from "hono";
import util from "node:util";
import { APIServerURLEnvironmentVariable } from "./constants";

let otelProvider: NodeTracerProvider | undefined;
let consolePatched = false;

function isPlainRecord(val: unknown): val is Record<string | number, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return false;
  }
  if (Object.prototype.toString.call(val) !== "[object Object]") {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

const patchGlobalConsole = () => {
  const inLambda = !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
  const useStructuredLogging = !!process.env.BLINK_USE_STRUCTURED_LOGGING;
  if (!inLambda && !useStructuredLogging) {
    return;
  }
  if (consolePatched) {
    return;
  }
  consolePatched = true;

  const safeTransform = (args: any[]): Record<string | number, unknown> => {
    let payload: Record<string | number, unknown>;
    if (args.length === 1) {
      if (typeof args[0] === "string") {
        payload = { message: args[0] };
      } else if (isPlainRecord(args[0])) {
        payload = args[0];
      } else {
        payload = { message: util.inspect(args[0]) };
      }
    } else {
      payload = { message: util.inspect(args) };
    }

    let safePayload: Record<string | number, unknown>;
    try {
      safePayload = JSON.parse(JSON.stringify(payload));
    } catch {
      safePayload = { message: util.inspect(payload) };
    }

    const activeSpanContext = trace.getActiveSpan()?.spanContext();
    if (activeSpanContext) {
      safePayload = {
        ...safePayload,
        trace_id: activeSpanContext.traceId,
        span_id: activeSpanContext.spanId,
      };
    }

    return safePayload;
  };

  const structuredLog = <T extends (...args: any[]) => void>(
    level: string,
    originalLog: T
  ) => {
    return (...args: any[]) => {
      const safePayload = safeTransform(args);
      // lambda does special log parsing, so we don't need to stringify it
      // or add the level field
      if (inLambda) {
        originalLog(safePayload);
        return;
      }
      originalLog(JSON.stringify({ level, ...safePayload }));
    };
  };

  console.log = structuredLog("info", console.log);
  console.error = structuredLog("error", console.error);
  console.warn = structuredLog("warn", console.warn);
  console.info = structuredLog("info", console.info);
  console.debug = structuredLog("info", console.debug);
  console.trace = structuredLog("info", console.trace);
};

class FilteringSpanProcessor implements SpanProcessor {
  constructor(
    private readonly delegate: SpanProcessor,
    private readonly shouldExport: (span: ReadableSpan) => boolean
  ) {}

  onStart(span: any, parentContext: any): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    // Only pass spans that pass the filter
    if (this.shouldExport(span)) {
      this.delegate.onEnd(span);
    }
  }

  async shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  async forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }
}

export function initOtel(): NodeTracerProvider {
  if (otelProvider) {
    return otelProvider;
  }
  patchGlobalConsole();

  const apiUrl = process.env[APIServerURLEnvironmentVariable];
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "blink.agent",
    }),
    spanProcessors: apiUrl
      ? [
          new FilteringSpanProcessor(
            new BatchSpanProcessor(
              // The Authorization header is added by the Blink API server proxy,
              // so we don't need to add it here.
              new OTLPHttpTraceExporter({
                url: new URL("/otlp/v1/traces", apiUrl).toString(),
              })
            ),
            (span) => {
              // UndiciInstrumentation creates an HTTP instrumentation that logs spans
              // for all outgoing HTTP requests, including the ones emitted by the trace exporter itself.
              // This creates an endless loop - we export a span, we emit a span for that export,
              // we export the second span, then we emit a span for that export, etc.
              // So here we filter out spans for the trace exporter itself to avoid the loop.
              const urlPath = span.attributes["url.path"];
              return !(
                span.instrumentationScope.name.includes("opentelemetry") &&
                typeof urlPath === "string" &&
                urlPath.endsWith("v1/traces")
              );
            }
          ),
        ]
      : [],
  });

  provider.register();

  registerInstrumentations({
    instrumentations: [
      new UndiciInstrumentation({
        // our runtime wrappers make some internal requests to the agent
        // that are detached from any other spans. we ignore such requests
        // to avoid noise.
        requireParentforSpans: true,
      }),
    ],
  });

  otelProvider = provider;
  return provider;
}

export const otelMiddleware: MiddlewareHandler = async (c, next) => {
  initOtel();
  const pathname = new URL(c.req.raw.url).pathname;
  if (pathname.startsWith("/_agent/flush-otel")) {
    return await next();
  }

  const tracer = trace.getTracer("blink");
  return await tracer.startActiveSpan(
    `${c.req.method} ${pathname}`,
    async (span) => {
      try {
        return await next();
      } finally {
        try {
          span.end();
        } catch (err) {
          console.warn("Error flushing OpenTelemetry", err);
        }
        // fire and forget. this is a best effort call.
        // a properly awaited flush should be handled by a POST to /_agent/flush-otel
        flushOtel();
      }
    }
  );
};

export const flushOtel = async () => {
  try {
    if (!otelProvider) {
      return;
    }
    await otelProvider.forceFlush();
  } catch (err) {
    console.warn("Error flushing OpenTelemetry", err);
  }
};
