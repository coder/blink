import { parsePartialJson, tool, type ToolSet } from "ai";
import { z } from "zod";

export interface ModelIntent {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly modelIntent: string;
}

export interface WithModelIntentOptions {
  /**
   * The time in milliseconds to debounce the model intents.
   * Default is 50ms to avoid spam.
   */
  debounce?: number;

  /**
   * A callback to be called with the model intents.
   * @param modelIntents The model intents. There could be multiple intents
   *                     if tool calls are made in parallel.
   */
  onModelIntents?: (modelIntents: ModelIntent[]) => Promise<void>;
}

/**
 * Wraps every tool in the tool set with a "model_intent" property.
 * This is useful for understanding the intent of tool calls.
 *
 * The "model_intent" can be sent elsewhere if relevant - for example, in a Slack status.
 *
 * @param tools
 * @param onModelIntent
 */
export default function withModelIntent(
  tools: ToolSet,
  options?: WithModelIntentOptions
): ToolSet {
  const wrapped: ToolSet = {};
  const inputDeltas: Record<string, string> = {};

  const debounceMs = options?.debounce ?? 50;
  let pendingByToolCallId: Record<string, ModelIntent> = {};
  let lastSentByToolCallId: Record<string, string> = {};
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const flushModelIntents = () => {
    if (!options?.onModelIntents) return;
    const values = Object.values(pendingByToolCallId);
    if (values.length === 0) return;

    const changed = values.filter(
      (intent) => lastSentByToolCallId[intent.toolCallId] !== intent.modelIntent
    );

    // Clear pending regardless; we only emit if something changed
    pendingByToolCallId = {};

    if (changed.length === 0) {
      debounceTimer = null;
      return;
    }

    // Fire and forget; consumer may be async
    void options.onModelIntents(changed);

    // Update last-sent snapshot after scheduling callback
    for (const intent of changed) {
      lastSentByToolCallId[intent.toolCallId] = intent.modelIntent;
    }

    debounceTimer = null;
  };

  const queueModelIntent = (intent: ModelIntent) => {
    if (!options?.onModelIntents) return;
    pendingByToolCallId[intent.toolCallId] = intent;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flushModelIntents, debounceMs);
  };

  for (const [key, value] of Object.entries(tools)) {
    wrapped[key] = tool({
      ...value,
      inputSchema: z.preprocess(
        (raw) => {
          if (!raw || typeof raw !== "object") {
            return raw;
          }
          const rawObj = raw as Record<string, unknown>;
          // Case 1: properties is missing but model_intent is top-level.
          // Wrap remaining top-level keys (excluding model_intent) into properties.
          if ("model_intent" in rawObj && !("properties" in rawObj)) {
            const { model_intent, ...rest } = rawObj;
            return {
              model_intent,
              properties: rest,
            };
          }

          // Case 2: model_intent mistakenly inside properties.
          if (!("model_intent" in rawObj) && "properties" in rawObj) {
            const props = rawObj["properties"] as unknown;
            if (
              props &&
              typeof props === "object" &&
              "model_intent" in (props as Record<string, unknown>)
            ) {
              const { model_intent, ...rest } = props as Record<
                string,
                unknown
              >;
              return {
                model_intent,
                properties: rest,
              };
            }
          }

          return raw;
        },
        z.object({
          model_intent: z
            .string()
            .describe(
              "A short present-participle description of the tool call's purpose."
            ),
          properties: value.inputSchema,
        })
      ),
      execute: value.execute
        ? function (this: any, input, options) {
            return value.execute!.call(this, input.properties, options);
          }
        : undefined,
      onInputDelta: async ({ inputTextDelta, toolCallId, abortSignal }) => {
        if (abortSignal?.aborted) {
          delete inputDeltas[toolCallId];
          delete pendingByToolCallId[toolCallId];
          delete lastSentByToolCallId[toolCallId];
          return;
        }
        if (abortSignal) {
          abortSignal.addEventListener(
            "abort",
            () => {
              delete inputDeltas[toolCallId];
              delete pendingByToolCallId[toolCallId];
              delete lastSentByToolCallId[toolCallId];
              if (
                Object.keys(pendingByToolCallId).length === 0 &&
                debounceTimer
              ) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
              }
            },
            { once: true }
          );
        }

        if (!inputDeltas[toolCallId]) {
          inputDeltas[toolCallId] = "";
        }
        inputDeltas[toolCallId] += inputTextDelta;

        const result = await parsePartialJson(inputDeltas[toolCallId]);
        if (
          result.value &&
          typeof result.value === "object" &&
          "model_intent" in result.value
        ) {
          queueModelIntent({
            toolName: key,
            toolCallId,
            modelIntent: (result.value as Record<string, unknown>)[
              "model_intent"
            ] as string,
          });
        }
      },
      onInputAvailable: ({ input, toolCallId, abortSignal }) => {
        if (abortSignal?.aborted) {
          delete inputDeltas[toolCallId];
          delete pendingByToolCallId[toolCallId];
          delete lastSentByToolCallId[toolCallId];
          return;
        }
        if (abortSignal) {
          abortSignal.addEventListener(
            "abort",
            () => {
              delete inputDeltas[toolCallId];
              delete pendingByToolCallId[toolCallId];
              delete lastSentByToolCallId[toolCallId];
              if (
                Object.keys(pendingByToolCallId).length === 0 &&
                debounceTimer
              ) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
              }
            },
            { once: true }
          );
        }

        queueModelIntent({
          toolName: key,
          toolCallId,
          modelIntent: input.model_intent,
        });
      },
    });
  }
  return wrapped;
}
