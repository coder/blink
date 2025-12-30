import { trace, type Attributes, type Span } from "@opentelemetry/api";
import util from "node:util";

export interface ChatCreatedEvent {
  kind: "chat_created";
  chatID: string;
  teamID: string;
  userID: string;
  visibility: string;
  source: string;
}

export interface StreamIterationEvent {
  kind: "stream_iteration";
  chatID: string;
  chatTeamID: string;
  chatModel: string;
  chatMode: string;
  chatSource: string;
  userID: string;
}

export interface LLMRequestEvent {
  kind: "llm_request";
  userID: string;
  chatID: string;
  chatTeamID: string;
  chatModel: string;
  chatMode: string;
  chatSource: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUSD: number;
  finishReason: string;
}

export type TelemetryEvent =
  | ChatCreatedEvent
  | StreamIterationEvent
  | LLMRequestEvent;

// Ensure that all telemetry events have a kind property.
const _check: TelemetryEvent extends { kind: string } ? true : false = true;

/**
 * Send a telemetry event to BigQuery. This will print the event to the console,
 * and the tail-worker will send it to BigQuery.
 *
 * @param event - The telemetry event to send.
 */
const track = (event: TelemetryEvent) => {
  const sc = trace.getActiveSpan()?.spanContext();
  console.log("telemetry-event", new Date().getTime(), sc?.spanId, event);
};

/**
 * Run a function within a span.
 *
 * @param options - The span options.
 * @param fn - The function to run.
 * @returns The result of the function.
 */
export const withSpan = <T>(
  options: { name: string; attributes?: Attributes },
  fn: (_span: Span) => Promise<T>
): Promise<T> => {
  const tracer = trace.getTracer("agent");
  return tracer.startActiveSpan(
    options.name,
    { attributes: options.attributes },
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        if (error instanceof Error || typeof error === "string") {
          span.recordException(error);
        } else {
          span.recordException(util.inspect(error, { depth: 5 }));
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
};
