import { tool, type Tool, type ModelMessage, APICallError } from "ai";
import { z } from "zod";
import type { Message } from "./types";

/**
 * Tool name for conversation compaction.
 * Used to identify compaction tool results in message history.
 */
export const COMPACT_CONVERSATION_TOOL_NAME = "compact_conversation" as const;

/**
 * Default token threshold for triggering compaction.
 */
export const DEFAULT_TOKEN_THRESHOLD = 100_000;

// Lazy-loaded tokenizer modules to avoid import issues
let tokenizerModule: typeof import("ai-tokenizer") | null = null;
let encodingModule: typeof import("ai-tokenizer/encoding/o200k_base") | null =
  null;
let sdkModule: typeof import("ai-tokenizer/sdk") | null = null;

async function getTokenizerModules() {
  if (!tokenizerModule) {
    tokenizerModule = await import("ai-tokenizer");
    encodingModule = await import("ai-tokenizer/encoding/o200k_base");
    sdkModule = await import("ai-tokenizer/sdk");
  }
  return { tokenizerModule, encodingModule, sdkModule };
}

/**
 * Get the model configuration for token counting.
 * Defaults to Claude Sonnet if model not found.
 */
function getModelConfig(models: Record<string, unknown>, modelName: string) {
  // Try to find exact match first
  if (modelName in models) {
    return models[modelName];
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
 * Counts tokens for messages using ai-tokenizer.
 */
export async function countConversationTokens(
  messages: ModelMessage[],
  modelName: string = "anthropic/claude-sonnet-4"
): Promise<number> {
  const { tokenizerModule, encodingModule, sdkModule } =
    await getTokenizerModules();
  if (!tokenizerModule || !encodingModule || !sdkModule) {
    // Fallback to rough estimate if modules not loaded
    const text = JSON.stringify(messages);
    return Math.ceil(text.length / 4);
  }

  const model = getModelConfig(tokenizerModule.models, modelName);
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
  const tokenizer = new tokenizerModule.Tokenizer(encodingModule as any);

  const result = sdkModule.count({
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
    tokenizer: tokenizer as any,
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
    model: model as any,
    messages,
  });

  return result.total;
}

/**
 * Checks if the conversation should be compacted based on token count.
 */
export async function shouldCompact(
  messages: ModelMessage[],
  modelName: string,
  threshold: number = DEFAULT_TOKEN_THRESHOLD
): Promise<boolean> {
  const tokenCount = await countConversationTokens(messages, modelName);
  return tokenCount >= threshold;
}

/**
 * Finds the most recent compaction summary in the message history.
 * Returns the index of the message containing the compaction and the summary text.
 */
export function findCompactionSummary(
  messages: Message[]
): { index: number; summary: string } | null {
  // Search from the end to find the most recent compaction
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;

    for (const part of message.parts) {
      // Check if this is our compaction tool
      if (part.type === `tool-${COMPACT_CONVERSATION_TOOL_NAME}`) {
        const toolPart = part as {
          state: string;
          output?: { summary?: string };
        };
        if (toolPart.state === "output-available" && toolPart.output?.summary) {
          return { index: i, summary: toolPart.output.summary };
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

  // Keep only messages from the compaction point onwards, prepended with the summary
  const messagesAfterCompaction = messages.slice(compaction.index);

  return [summaryMessage, ...messagesAfterCompaction];
}

/**
 * Creates the compact_conversation tool.
 * This tool should be called by the model when the conversation is getting too long.
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
        // The summary is stored in the tool result and will be processed
        // by applyCompaction() on subsequent messages
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
 * Generates a user message for compaction warning when threshold is approaching.
 */
export function createCompactionWarningMessage(
  tokenCount: number,
  threshold: number
): Message {
  const percentUsed = Math.round((tokenCount / threshold) * 100);
  return {
    id: "compaction-warning",
    role: "user",
    parts: [
      {
        type: "text",
        text: `[SYSTEM NOTICE - CONTEXT LIMIT WARNING]

The conversation has used approximately ${percentUsed}% of the available context (${tokenCount.toLocaleString()} tokens out of ${threshold.toLocaleString()}).

To prevent context overflow errors, please call the \`compact_conversation\` tool NOW to summarize the conversation history.

Provide a detailed and thorough summary that captures all important context, decisions, code changes, file paths, and ongoing tasks. Do not leave out important details.`,
      },
    ],
  };
}

/**
 * Error patterns that indicate context length exceeded.
 * Different providers use different error messages.
 */
const CONTEXT_LENGTH_ERROR_PATTERNS = [
  /context.{0,20}length.{0,20}exceed/i,
  /maximum.{0,20}context.{0,20}length/i,
  /token.{0,20}limit.{0,20}exceed/i,
  /too.{0,20}many.{0,20}tokens/i,
  /input.{0,20}too.{0,20}long/i,
  /prompt.{0,20}too.{0,20}long/i,
  /request.{0,20}too.{0,20}large/i,
  /content.{0,20}length.{0,20}limit/i,
  /max_tokens/i,
  /context_length_exceeded/i,
];

/**
 * Checks if an error is a context length exceeded error.
 */
export function isContextLengthError(error: unknown): boolean {
  if (!error) return false;

  // Check if it's an APICallError from the AI SDK
  if (APICallError.isInstance(error)) {
    const message = error.message || "";
    const responseBody = error.responseBody || "";
    const combinedText = `${message} ${responseBody}`;

    for (const pattern of CONTEXT_LENGTH_ERROR_PATTERNS) {
      if (pattern.test(combinedText)) {
        return true;
      }
    }
  }

  // Check generic Error
  if (error instanceof Error) {
    for (const pattern of CONTEXT_LENGTH_ERROR_PATTERNS) {
      if (pattern.test(error.message)) {
        return true;
      }
    }
  }

  // Check string error
  if (typeof error === "string") {
    for (const pattern of CONTEXT_LENGTH_ERROR_PATTERNS) {
      if (pattern.test(error)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Configuration for emergency compaction when context is exceeded.
 */
export interface EmergencyCompactionConfig {
  /** Total number of messages in the conversation */
  totalMessages: number;
  /** Number of recent messages to keep for context */
  recentMessagesToKeep: number;
}

/**
 * Calculates how many messages to include in an emergency compaction request.
 * When a compaction request itself exceeds context, we need to reduce the
 * messages we ask the model to summarize.
 */
export function calculateEmergencyCompactionConfig(
  totalMessages: number,
  previousAttemptMessageCount?: number
): EmergencyCompactionConfig {
  // If this is our first attempt, try summarizing about half the messages
  // keeping the most recent ones outside the summary
  if (!previousAttemptMessageCount) {
    const recentMessagesToKeep = Math.min(10, Math.floor(totalMessages * 0.2));
    return {
      totalMessages,
      recentMessagesToKeep,
    };
  }

  // If we've tried before and still failed, be more aggressive
  // Reduce the messages to summarize by half each time
  const messagesToSummarize = Math.floor(
    (totalMessages - previousAttemptMessageCount) / 2
  );
  const recentMessagesToKeep = totalMessages - messagesToSummarize;

  return {
    totalMessages,
    recentMessagesToKeep: Math.max(5, recentMessagesToKeep), // Keep at least 5 messages
  };
}

/**
 * Creates an emergency compaction request message.
 * This is used when the compaction request itself exceeds context limits.
 * It asks the model to summarize only a portion of the conversation.
 */
export function createEmergencyCompactionMessage(
  config: EmergencyCompactionConfig
): Message {
  const messagesToSummarize =
    config.totalMessages - config.recentMessagesToKeep;

  return {
    id: "emergency-compaction-request",
    role: "user",
    parts: [
      {
        type: "text",
        text: `[EMERGENCY CONTEXT RECOVERY]

The previous compaction attempt exceeded context limits. Please call the \`compact_conversation\` tool with a summary of ONLY the first ${messagesToSummarize} messages of this conversation.

The ${config.recentMessagesToKeep} most recent messages will be preserved and appended after your summary.

Focus your summary on:
- Key decisions and conclusions from the earlier conversation
- Important file paths and code changes mentioned
- Critical context that would be needed to understand the recent messages

Be thorough but focus on the most important information from the earlier messages.`,
      },
    ],
  };
}

/**
 * Prepares messages for an emergency compaction attempt by truncating older messages.
 * Returns the messages to send to the model and the messages to preserve.
 */
export function prepareEmergencyCompactionMessages(
  messages: Message[],
  config: EmergencyCompactionConfig
): { messagesToProcess: Message[]; messagesToPreserve: Message[] } {
  const splitPoint = messages.length - config.recentMessagesToKeep;

  // Messages to include in the compaction request (older messages to summarize)
  const messagesToProcess = messages.slice(0, splitPoint);

  // Messages to preserve and append after compaction
  const messagesToPreserve = messages.slice(splitPoint);

  return {
    messagesToProcess,
    messagesToPreserve,
  };
}
