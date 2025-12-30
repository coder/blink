import { trace } from "@opentelemetry/api";
import util from "node:util";

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceSampled: boolean;
}

export interface LogEntry {
  message: string;
  attributes?: Record<string, unknown>;
  spanContext?: SpanContext;
}

class Logger {
  private getTraceContext(): SpanContext | undefined {
    const sc = trace.getActiveSpan()?.spanContext();
    if (sc) {
      return {
        traceId: sc.traceId,
        spanId: sc.spanId,
        traceSampled: (sc.traceFlags & 0x1) === 1,
      } satisfies SpanContext;
    }
    return undefined;
  }

  private sanitize(obj: unknown): { ok: boolean; value: unknown } {
    try {
      return { ok: true, value: JSON.parse(JSON.stringify(obj ?? null)) };
    } catch (err) {
      return {
        ok: false,
        value: {
          error: util.inspect(err, { depth: 5 }),
          inspectedAttributes: util.inspect(obj, { depth: 5 }),
        },
      };
    }
  }

  private write(
    level: "log" | "warn" | "error",
    message: string,
    attributes?: Record<string, unknown>
  ) {
    const { ok, value } = this.sanitize(attributes);
    if (!ok) {
      message = `${message} (failed to sanitize attributes)`;
      level = "error";
    }

    // this is parsed by the tail-worker
    const entry: LogEntry = {
      message,
      attributes: value as Record<string, unknown>,
      spanContext: this.getTraceContext(),
    };

    switch (level) {
      case "log":
        console.log(entry);
        break;
      case "warn":
        console.warn(entry);
        break;
      case "error":
        console.error(entry);
        break;
      default:
        throw new Error(`unknown level: ${level}`);
    }
  }

  info(message: string, attributes?: Record<string, unknown>) {
    this.write("log", message, attributes);
  }

  warn(message: string, attributes?: Record<string, unknown>) {
    this.write("warn", message, attributes);
  }

  error(message: string, attributes?: Record<string, unknown>) {
    this.write("error", message, attributes);
  }

  log(message: string, attributes?: Record<string, unknown>) {
    this.write("log", message, attributes);
  }
}

/**
 * The logger ensures that logs are correlated with OpenTelemetry traces.
 */
export const logger = new Logger();
