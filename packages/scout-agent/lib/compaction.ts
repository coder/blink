import {
  convertToModelMessages,
  type LanguageModel,
  type ModelMessage,
  type Tool,
  tool,
} from "ai";
import { z } from "zod";
import type { Logger, Message } from "./types";

/**
 * Tool name for conversation compaction.
 * Used to identify compaction tool results in message history.
 */
export const COMPACT_CONVERSATION_TOOL_NAME = "compact_conversation" as const;

/**
 * Default soft token threshold for triggering compaction.
 * When conversation tokens reach this limit, compaction is triggered.
 */
export const DEFAULT_SOFT_TOKEN_THRESHOLD = 180_000;

/**
 * Default hard token threshold for compaction.
 * Messages beyond this limit are excluded from compaction and preserved.
 * Must be greater than soft threshold.
 */
export const DEFAULT_HARD_TOKEN_THRESHOLD = 190_000;

/**
 * Get the model configuration for token counting.
 * Defaults to Claude Sonnet if model not found.
 */
function getModelConfig(models: Record<string, unknown>, modelName: string) {
  // Try to find exact match first
  if (modelName in models) {
    return models[modelName as keyof typeof models];
  }
  // Default to Claude Sonnet for Anthropic models
  if (modelName.includes("anthropic") || modelName.includes("claude")) {
    return models["anthropic/claude-sonnet-4"];
  }
  // Default to GPT-5 for OpenAI models
  if (modelName.includes("openai") || modelName.includes("gpt")) {
    return models["openai/gpt-5"];
  }
  // Fallback
  return models["anthropic/claude-sonnet-4"];
}

/**
 * Result of counting tokens for messages.
 */
export interface TokenCountResult {
  /** Total tokens across all messages */
  total: number;
  /** Token count for each message */
  perMessage: number[];
}

/**
 * Counts tokens for messages using ai-tokenizer.
 * Returns both total and per-message token counts for efficient processing.
 */
export async function countConversationTokens(
  messages: ModelMessage[],
  modelName: string = "anthropic/claude-sonnet-4"
): Promise<TokenCountResult> {
  // we import the modules dynamically because otherwise the
  // agent starts up super slow and blink cloud times out during deployment
  const aiTokenizer = await import("ai-tokenizer");
  const encoding = await import("ai-tokenizer/encoding/o200k_base");
  const tokenizerSdk = await import("ai-tokenizer/sdk");

  const model = getModelConfig(aiTokenizer.models, modelName);
  const tokenizer = new aiTokenizer.Tokenizer(encoding);

  const result = tokenizerSdk.count({
    // biome-ignore lint/suspicious/noExplicitAny: weird typing error
    tokenizer: tokenizer as any,
    // biome-ignore lint/suspicious/noExplicitAny: weird typing error
    model: model as any,
    messages,
  });

  return {
    total: result.total,
    perMessage: result.messages.map((m) => m.total),
  };
}

/**
 * Finds the most recent compaction summary in the message history.
 * Returns the index of the message containing the compaction, the summary text,
 * and optionally the preserved message IDs.
 */
export function findCompactionSummary(messages: Message[]): {
  index: number;
  summary: string;
  preservedMessageIds?: string[];
} | null {
  // Search from the end to find the most recent compaction
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      // Check if this is our compaction tool
      if (part.type === `tool-${COMPACT_CONVERSATION_TOOL_NAME}`) {
        const toolPart = part as {
          state: string;
          output?: { summary?: string; preservedMessageIds?: string[] };
        };
        if (toolPart.state === "output-available" && toolPart.output?.summary) {
          return {
            index: i,
            summary: toolPart.output.summary,
            preservedMessageIds: toolPart.output.preservedMessageIds,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Processes messages to apply compaction if a compaction summary exists.
 * Returns messages with history before the compaction replaced by a summary message.
 */
export function applyCompaction(messages: Message[]): Message[] {
  const compaction = findCompactionSummary(messages);
  if (!compaction) {
    return messages;
  }

  // Create a synthetic user message with the compacted summary
  const summaryMessage: Message = {
    id: "compaction-summary",
    role: "user",
    parts: [
      {
        type: "text",
        text: `[CONVERSATION SUMMARY - Previous messages have been compacted to save context space]\n\n${compaction.summary}\n\n[END OF SUMMARY - Conversation continues below]`,
      },
    ],
  };

  // Get messages after the compaction point (excludes the compaction tool call itself)
  const messagesAfterCompaction = messages.slice(compaction.index + 1);

  // Check for preserved message IDs (from hard threshold truncation)
  if (
    compaction.preservedMessageIds &&
    compaction.preservedMessageIds.length > 0
  ) {
    // Keep summary + preserved messages by ID + messages after compaction
    const preservedIdSet = new Set(compaction.preservedMessageIds);
    const preserved = messages.filter((m) => preservedIdSet.has(m.id));

    // Combine preserved messages with messages after compaction (deduplicated)
    const afterCompactionIds = new Set(
      messagesAfterCompaction.map((m) => m.id)
    );
    const preservedNotInAfter = preserved.filter(
      (m) => !afterCompactionIds.has(m.id)
    );

    return [summaryMessage, ...preservedNotInAfter, ...messagesAfterCompaction];
  }

  // Normal compaction: keep messages from the compaction point onwards
  return [summaryMessage, ...messagesAfterCompaction];
}

/**
 * Creates the compact_conversation tool.
 * This tool should be called by the model when the conversation is getting too long.
 *
 * @param preservedMessageIds - Optional array of message IDs that should be preserved
 *   after compaction. Used during emergency compaction to track which recent messages
 *   were not sent to the model but should be restored after the summary.
 */
export function createCompactionTool(
  preservedMessageIds?: string[]
): Record<typeof COMPACT_CONVERSATION_TOOL_NAME, Tool> {
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
        // The summary is stored in the tool result and will be processed
        // by applyCompaction() on subsequent messages
        return {
          summary,
          compacted_at: new Date().toISOString(),
          message:
            "Conversation history has been compacted. The summary will be used to maintain context in future messages.",
          ...(preservedMessageIds &&
            preservedMessageIds.length > 0 && { preservedMessageIds }),
        };
      },
    }),
  };
}

/**
 * Creates a compaction request message asking the model to summarize the conversation.
 * Uses a consistent ID ("compaction-request") for retry detection.
 */
export function createCompactionMessage(options?: {
  tokenCount?: number;
  threshold?: number;
}): Message {
  let contextInfo = "";
  if (options?.tokenCount && options?.threshold) {
    const percentUsed = Math.round(
      (options.tokenCount / options.threshold) * 100
    );
    contextInfo = `\n\nThe conversation has used approximately ${percentUsed}% of the available context (${options.tokenCount.toLocaleString()} tokens).`;
  }

  return {
    id: `compaction-request-${Date.now()}`,
    role: "user",
    parts: [
      {
        type: "text",
        text: `[SYSTEM NOTICE - CONTEXT LIMIT]${contextInfo}

To prevent context overflow errors, please call the \`compact_conversation\` tool NOW to summarize the conversation history.

Provide a detailed and thorough summary that captures all important context, decisions, code changes, file paths, and ongoing tasks. Do not leave out important details.`,
      },
    ],
  };
}

/**
 * Options for preparing truncated messages.
 */
export interface PrepareTruncatedMessagesOptions {
  /** All messages to consider for truncation */
  messages: Message[];
  /** Maximum token count for messages to process */
  tokenLimit: number;
  /** Model name for token counting */
  modelName: string;
}

/**
 * Result of preparing truncated messages.
 */
export interface PrepareTruncatedMessagesResult {
  /** Messages to send for summarization (older messages, within token limit) */
  messagesToProcess: Message[];
  /** Messages to preserve and restore after compaction */
  messagesToPreserve: Message[];
}

/**
 * Prepares messages for a truncated compaction attempt.
 * Accumulates messages from the start (oldest first) until adding more would exceed the token limit.
 *
 * @returns Messages split into those to process (summarize) and those to preserve
 */
export async function prepareTruncatedMessages(
  options: PrepareTruncatedMessagesOptions
): Promise<PrepareTruncatedMessagesResult> {
  const { messages, tokenLimit, modelName } = options;

  if (messages.length === 0) {
    return { messagesToProcess: [], messagesToPreserve: [] };
  }

  // Convert all messages once and get per-message token counts
  const converted = convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
  });
  const { perMessage } = await countConversationTokens(converted, modelName);

  // Find the split point by accumulating token counts
  // until we would exceed the token limit
  let splitPoint = 0;
  let cumulativeTokens = 0;

  for (let i = 0; i < perMessage.length; i++) {
    cumulativeTokens += perMessage[i] ?? 0;
    if (cumulativeTokens > tokenLimit) {
      // Adding this message would exceed the limit
      break;
    }
    splitPoint = i + 1;
  }

  // Ensure we have at least one message to process (if possible)
  if (splitPoint === 0 && messages.length > 0) {
    // Even the first message exceeds the limit, but we need to process something
    splitPoint = 1;
  }

  const messagesToProcess = messages.slice(0, splitPoint);
  const messagesToPreserve = messages.slice(splitPoint);

  return {
    messagesToProcess,
    messagesToPreserve,
  };
}

/**
 * Options for processing compaction.
 */
export interface ProcessCompactionOptions {
  messages: Message[];
  /** Soft threshold - triggers compaction when reached */
  softTokenThreshold: number;
  /** Hard threshold - max tokens to send for compaction; rest are preserved */
  hardTokenThreshold: number;
  model: LanguageModel | string;
  logger: Logger;
}

/**
 * Result of processing compaction.
 */
export interface ProcessCompactionResult {
  messages: Message[];
  compactionTool: Record<string, Tool>;
}

/**
 * Extracts model name from a LanguageModel or string.
 */
function getModelName(model: LanguageModel | string): string {
  if (typeof model === "string") {
    return model;
  }
  if ("modelId" in model) {
    return model.modelId;
  }
  return "anthropic/claude-sonnet-4";
}

/**
 * Processes messages for compaction.
 * Applies any existing compaction summary, checks token count against soft threshold,
 * and truncates at hard threshold when compacting.
 */
export async function processCompaction(
  options: ProcessCompactionOptions
): Promise<ProcessCompactionResult> {
  const { messages, softTokenThreshold, hardTokenThreshold, model, logger } =
    options;

  // Validate thresholds
  if (softTokenThreshold >= hardTokenThreshold) {
    throw new Error(
      `Soft token threshold (${softTokenThreshold}) must be less than hard token threshold (${hardTokenThreshold})`
    );
  }

  const modelName = getModelName(model);

  // Apply compaction if a compaction summary exists in the message history
  const compactedMessages = applyCompaction(messages);
  if (compactedMessages.length === 0) {
    return { messages: [], compactionTool: {} };
  }

  // Check token count and handle compaction
  let preservedMessageIds: string[] | undefined;

  // We need to convert messages to count tokens accurately
  const tempConverted = convertToModelMessages(compactedMessages, {
    ignoreIncompleteToolCalls: true,
  });
  const { total: tokenCount } = await countConversationTokens(
    tempConverted,
    modelName
  );

  if (tokenCount < softTokenThreshold) {
    return { messages: compactedMessages, compactionTool: {} };
  }

  // Soft threshold reached - trigger compaction
  logger.info(
    `Conversation approaching context limit: ${tokenCount.toLocaleString()} tokens (soft threshold: ${softTokenThreshold.toLocaleString()})`
  );

  // Truncate messages at hard threshold to ensure compaction request fits
  const { messagesToProcess, messagesToPreserve } =
    await prepareTruncatedMessages({
      messages: compactedMessages,
      tokenLimit: hardTokenThreshold,
      modelName,
    });

  // Store preserved message IDs for the compaction tool result
  if (messagesToPreserve.length > 0) {
    preservedMessageIds = messagesToPreserve.map((m) => m.id);
    logger.info(
      `Compaction: sending ${messagesToProcess.length} messages for summarization, preserving ${messagesToPreserve.length} recent messages`
    );
  }

  return {
    messages: [
      ...messagesToProcess,
      createCompactionMessage({
        tokenCount,
        threshold: softTokenThreshold,
      }),
    ],
    compactionTool: createCompactionTool(preservedMessageIds),
  };
}
