import util from "node:util";
import {
  APICallError,
  type StreamTextTransform,
  type TextStreamPart,
  type Tool,
  type ToolSet,
  tool,
} from "ai";
import { z } from "zod";
import type { Message } from "./types";

// Constants
export const COMPACTION_MARKER_TOOL_NAME = "__compaction_marker";
export const COMPACT_CONVERSATION_TOOL_NAME = "compact_conversation";
export const MAX_CONSECUTIVE_COMPACTION_ATTEMPTS = 5;

// Error patterns for out-of-context detection (regex)
const OUT_OF_CONTEXT_PATTERNS = [
  /context.*(length|limit|window|exceeded)/i,
  /token.*(limit|exceeded|maximum)/i,
  /maximum.*context/i,
  /input.*too.*long/i,
  /prompt.*too.*long/i,
  // Anthropic specific
  /max_tokens_exceeded/i,
  // OpenAI specific
  /context_length_exceeded/i,
  /maximum.*tokens/i,
];

/**
 * Recursively search for an APICallError in the error's cause chain.
 */
export function findAPICallError(error: unknown): APICallError | null {
  if (APICallError.isInstance(error)) {
    return error;
  }
  if (error && typeof error === "object" && "cause" in error) {
    const cause = (error as { cause?: unknown }).cause;
    return findAPICallError(cause);
  }
  return null;
}

/**
 * Check if an error is an out-of-context error based on known patterns.
 *
 * TODO: the current patterns only really handle anthropic via the vercel
 * gateway - we need to test with other providers.
 */
export function isOutOfContextError(error: unknown): boolean {
  const apiError = findAPICallError(error);
  if (!apiError) {
    return false;
  }
  let textToTest = apiError.responseBody ?? "";
  // even though typings say message is always a string, empirically it's not always a string
  if (!textToTest && typeof apiError.message === "string") {
    textToTest = apiError.message;
  }
  if (!textToTest) {
    try {
      textToTest = JSON.stringify(apiError);
    } catch {
      // note: util.inspect returns different values in Bun and Node.js
      // in Node.js it includes the error message, in Bun it doesn't
      // that's why it's the final fallback
      textToTest = util.inspect(apiError, { depth: null });
    }
  }
  return OUT_OF_CONTEXT_PATTERNS.some((pattern) => pattern.test(textToTest));
}

/**
 * Creates a stream transform that detects out-of-context errors and emits a compaction marker.
 */
export function createCompactionTransform<T extends ToolSet>(
  onCompactionTriggered?: () => void
): StreamTextTransform<T> {
  return ({ stopStream }) =>
    new TransformStream<TextStreamPart<T>, TextStreamPart<T>>({
      transform(chunk, controller) {
        if (
          chunk?.type === "error" &&
          isOutOfContextError((chunk as { error?: unknown }).error)
        ) {
          onCompactionTriggered?.();
          const markerPart = createCompactionMarkerPart();
          controller.enqueue({
            type: "tool-call",
            toolCallType: "function",
            toolCallId: markerPart.toolCallId,
            toolName: markerPart.toolName,
            input: markerPart.input,
            dynamic: true,
          } as TextStreamPart<T>);
          controller.enqueue({
            type: "tool-result",
            toolCallId: markerPart.toolCallId,
            toolName: markerPart.toolName,
            input: markerPart.input,
            output: markerPart.output,
            providerExecuted: false,
            dynamic: true,
          } as TextStreamPart<T>);
          controller.enqueue({
            type: "finish",
            finishReason: "tool-calls",
            logprobs: undefined,
            totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          } as TextStreamPart<T>);
          stopStream();
          return;
        }
        controller.enqueue(chunk);
      },
    });
}

/**
 * Create the compact_conversation tool for the model to call.
 */
export function createCompactionTool(): Record<
  typeof COMPACT_CONVERSATION_TOOL_NAME,
  Tool
> {
  return {
    [COMPACT_CONVERSATION_TOOL_NAME]: tool({
      description: `Compact the conversation history to save context space. Call this tool when instructed that the conversation is approaching context limits. Provide a detailed and thorough summary that captures:
- The main topics discussed
- Key decisions made
- Important code changes or file modifications (include file paths and what was changed)
- Any ongoing tasks or action items
- Critical context needed to continue the conversation
- Relevant technical details, configurations, or environment information
- Any errors encountered and how they were resolved

Be thorough and detailed. This summary will replace the earlier conversation history, so include all information needed to continue effectively.`,
      inputSchema: z.object({
        summary: z
          .string()
          .describe(
            "A detailed and thorough summary of the conversation so far, including all important context needed to continue effectively."
          ),
      }),
      execute: async ({ summary }) => {
        return {
          summary,
          compacted_at: new Date().toISOString(),
          message:
            "Conversation history has been compacted. The summary will be used to maintain context in future messages.",
        };
      },
    }),
  };
}

/**
 * Check if a message part is a compaction marker.
 */
function isCompactionMarkerPart(part: Message["parts"][number]): boolean {
  return (
    (part.type === "dynamic-tool" &&
      "toolName" in part &&
      part.toolName === COMPACTION_MARKER_TOOL_NAME) ||
    part.type === `tool-${COMPACTION_MARKER_TOOL_NAME}`
  );
}

function isCompactionMarkerMessage(message: Message): boolean {
  return message.parts.some((part) => isCompactionMarkerPart(part));
}

/**
 * Check if a message part is a compaction summary.
 */
function isCompactionSummaryPart(part: Message["parts"][number]): boolean {
  return (
    (part.type === `tool-${COMPACT_CONVERSATION_TOOL_NAME}` ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === COMPACT_CONVERSATION_TOOL_NAME)) &&
    "state" in part &&
    part.state === "output-available" &&
    "output" in part
  );
}

function isCompactConversationPart(part: Message["parts"][number]): boolean {
  return (
    part.type === `tool-${COMPACT_CONVERSATION_TOOL_NAME}` ||
    (part.type === "dynamic-tool" &&
      "toolName" in part &&
      part.toolName === COMPACT_CONVERSATION_TOOL_NAME)
  );
}

export interface CompactionMarkerPart {
  type: "dynamic-tool";
  toolName: typeof COMPACTION_MARKER_TOOL_NAME;
  toolCallId: string;
  state: "output-available";
  input: {
    model_intent: string;
  };
  output: string;
}

/**
 * Create a synthetic tool call part for the compaction marker.
 * This is emitted when an out-of-context error is detected.
 */
export function createCompactionMarkerPart(): CompactionMarkerPart {
  return {
    type: "dynamic-tool",
    toolCallId: `compaction-marker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    toolName: COMPACTION_MARKER_TOOL_NAME,
    state: "output-available",
    input: {
      model_intent: "Out of context, compaction in progress...",
    },
    output:
      "Compaction marker - this will trigger compaction on the next iteration",
  };
}

interface CompactionSummaryResult {
  summary: string;
  compacted_at: string;
}

/**
 * Find a successful compaction summary in the messages.
 */
export function findCompactionSummary(messages: Message[]): {
  summary: string;
  compactedAt: string;
  messageIndex: number;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;

    for (const part of message.parts) {
      if (isCompactionSummaryPart(part) && "output" in part) {
        const output = part.output as CompactionSummaryResult | undefined;
        if (output?.summary) {
          return {
            summary: output.summary,
            compactedAt: output.compacted_at,
            messageIndex: i,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Count consecutive compaction markers in the messages (markers without a summary in between).
 * This is used to determine the retry count - each marker represents a failed compaction attempt.
 *
 * @param messages The messages to search
 * @param beforeIndex Optional index to stop at (exclusive). If provided, only counts markers before this index.
 */
export function countCompactionMarkers(
  messages: Message[],
  beforeIndex?: number
): number {
  let count = 0;
  const endIndex = beforeIndex ?? messages.length;
  // Scan from the end (or beforeIndex) to find markers, stop if we find a summary
  for (let i = endIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (isCompactionSummaryPart(part)) {
        return count;
      }
      if (isCompactionMarkerPart(part)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Finds the maximum number of consecutive assistant messages that contain
 * compaction tool calls. The streak resets when a non-assistant message
 * is encountered.
 *
 * @param messages - The message history to analyze
 * @returns The longest streak of consecutive compaction attempts
 */
export function maxConsecutiveCompactionAttempts(messages: Message[]): number {
  let maxAttempts = 0;
  let attempts = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    if (message.role !== "assistant") {
      attempts = 0;
    }
    const hasCompactionPart = message.parts.some((part) =>
      isCompactConversationPart(part)
    );
    if (hasCompactionPart) {
      attempts++;
      maxAttempts = Math.max(maxAttempts, attempts);
    }
  }

  return maxAttempts;
}

/**
 * Build the compaction request message that instructs the model to compact.
 */
export function buildCompactionRequestMessage(): Message {
  return {
    id: `compaction-request-${Date.now()}`,
    role: "user",
    parts: [
      {
        type: "text",
        text: `[SYSTEM NOTICE - CONTEXT LIMIT]
Your conversation has exceeded the context window.

To prevent context overflow errors, please call the \`compact_conversation\` tool NOW to summarize the conversation history.

Provide a detailed and thorough summary that captures all important context, decisions, code changes, file paths, and ongoing tasks. Do not leave out important details.`,
      },
    ],
  };
}

/**
 * Build a summary message that replaces the compacted conversation history.
 */
export function buildCompactionSummaryMessages(
  summary: string,
  compactedAt: string
): Message[] {
  return [
    {
      id: "compaction-summary",
      role: "user",
      parts: [
        {
          type: "text",
          text: `[CONVERSATION SUMMARY - Previously compacted at ${compactedAt}]

${summary}

---
The conversation continues from this point.`,
        },
      ],
    },
    // Add an assistant response to make sure that, when the next message is a "user" message,
    // the provider won't throw an error. Some APIs don't accept consecutive "user" messages.
    {
      id: "compaction-summary-response",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Acknowledged.",
        },
      ],
    },
  ] as const;
}

/**
 * Finds the most recent summary and applies it to the messages.
 */
function applySummaryToMessages(messages: Message[]): Message[] {
  const summary = findCompactionSummary(messages);
  if (!summary) {
    return messages;
  }
  const markerCount = countCompactionMarkers(messages, summary?.messageIndex);
  const excludedMessagesStartIndex = findExcludedMessagesStartIndex(
    messages.slice(0, summary.messageIndex),
    markerCount
  );
  const summaryMessages = buildCompactionSummaryMessages(
    summary.summary,
    summary.compactedAt
  );
  const excludedMessages = messages
    .slice(excludedMessagesStartIndex, summary.messageIndex)
    .filter((m) => !m.parts.some((p) => isCompactionMarkerPart(p)));

  return [
    ...summaryMessages,
    ...excludedMessages,
    ...messages.slice(summary.messageIndex + 1),
  ];
}

function findExcludedMessagesStartIndex(
  messages: Message[],
  markerCount: number
): number {
  if (markerCount <= 0) {
    return messages.length;
  }
  let lastUserIndex = messages.length;
  let found = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: we know the message is not null
    const message = messages[i]!;
    if (isCompactionMarkerMessage(message)) {
      continue;
    }
    lastUserIndex = i;
    found++;
    if (found === markerCount) {
      return lastUserIndex;
    }
  }
  return 0;
}

function transformMessagesForCompaction(messages: Message[]): Message[] {
  const markerCount = countCompactionMarkers(messages);
  if (markerCount === 0) {
    return messages;
  }
  const excludedMessagesStartIndex = findExcludedMessagesStartIndex(
    messages,
    markerCount
  );
  if (excludedMessagesStartIndex === 0) {
    throw new CompactionError(
      "Cannot compact: would leave only the compaction request",
      markerCount - 1
    );
  }
  return [
    ...messages.slice(0, excludedMessagesStartIndex),
    buildCompactionRequestMessage(),
  ];
}

/**
 * Apply compaction logic to messages, handling both summary application and compaction requests.
 *
 * This function is the main entry point for the compaction system. It processes messages
 * in two phases:
 *
 * ## Phase 1: Apply existing summaries (`applySummaryToMessages`)
 * If the messages contain a successful `compact_conversation` tool result (a summary),
 * this phase replaces the earlier conversation history with:
 * 1. Summary messages (user message with summary + assistant acknowledgment)
 * 2. Messages that were excluded when building the compaction request (restored here because
 *    they weren't in the context when the model wrote the summary). These are the last N
 *    user turns before the summary, where N = marker count before the summary.
 * 3. Messages after the summary
 *
 * **Multiple summaries**: Only the most recent summary is used. Earlier summaries are
 * discarded because the model had them in context when generating the newer summary,
 * so their content should be incorporated. Summaries are cumulative, not layered.
 *
 * ## Phase 2: Transform for compaction request (`transformMessagesForCompaction`)
 * If compaction markers are present (indicating out-of-context errors were caught),
 * this phase:
 * 1. Counts consecutive markers to determine retry count
 * 2. Excludes the last N user message "turns" (where N = marker count). Each marker
 *    represents an out-of-context error, meaning the conversation was too long for the
 *    model to process. By excluding more messages on each retry, we reduce the input
 *    size so the model has room to generate the summary.
 * 3. Appends a compaction request message asking the model to call `compact_conversation`
 *
 * ## Retry mechanism
 * Each compaction marker represents an out-of-context error. The first marker typically
 * comes from normal operation (the conversation grew too long). Subsequent markers
 * indicate that even the compaction request itself was too long. On each retry, more
 * messages are excluded to give the model room to generate the summary. If all messages
 * would be excluded, throws `CompactionError`.
 *
 * ## Flow example
 * 1. Model hits context limit → compaction transform emits compaction marker
 * 2. Next iteration calls this function
 * 3. Messages are truncated + compaction request appended
 * 4. Model calls `compact_conversation` with summary
 * 5. Next iteration: summary is applied, old messages replaced
 *
 * @param messages - The full conversation message history
 * @returns Transformed messages ready to send to the model
 * @throws {CompactionError} If compaction would leave no messages (too many retries)
 */
export function applyCompactionToMessages(messages: Message[]): Message[] {
  const compactionAttempts = maxConsecutiveCompactionAttempts(messages);
  if (compactionAttempts >= MAX_CONSECUTIVE_COMPACTION_ATTEMPTS) {
    throw new CompactionError(
      `Compaction loop detected after ${compactionAttempts} attempts`,
      compactionAttempts
    );
  }

  const currentConversation = applySummaryToMessages(messages);
  const transformedMessages =
    transformMessagesForCompaction(currentConversation);
  return transformedMessages.filter(
    (message) => !message.parts.some((part) => isCompactionMarkerPart(part))
  );
}

export class CompactionError extends Error {
  constructor(
    message: string,
    public readonly retryCount: number
  ) {
    super(message);
    this.name = "CompactionError";
  }
}
