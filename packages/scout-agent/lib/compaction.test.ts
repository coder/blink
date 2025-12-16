/** biome-ignore-all lint/suspicious/noExplicitAny: testing */
import { describe, expect, test } from "bun:test";
import {
  applyCompaction,
  COMPACT_CONVERSATION_TOOL_NAME,
  createCompactionMessage,
  createCompactionTool,
  findCompactionSummary,
  prepareTruncatedMessages,
} from "./compaction";
import type { Message } from "./types";

describe("compaction", () => {
  describe("findCompactionSummary", () => {
    test("returns null when no compaction exists", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Hi there!" }],
        },
      ];

      expect(findCompactionSummary(messages)).toBeNull();
    });

    test("finds compaction summary in assistant message", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: {
                summary: "This is the summary of the conversation.",
                compacted_at: "2024-01-01T00:00:00.000Z",
              },
            } as any,
          ],
        },
        {
          id: "3",
          role: "user",
          parts: [{ type: "text", text: "Continue" }],
        },
      ];

      const result = findCompactionSummary(messages);
      expect(result).not.toBeNull();
      expect(result?.index).toBe(1);
      expect(result?.summary).toBe("This is the summary of the conversation.");
    });

    test("finds most recent compaction when multiple exist", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: { summary: "First summary" },
            } as any,
          ],
        },
        {
          id: "2",
          role: "user",
          parts: [{ type: "text", text: "More conversation" }],
        },
        {
          id: "3",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: { summary: "Second summary" },
            } as any,
          ],
        },
      ];

      const result = findCompactionSummary(messages);
      expect(result?.index).toBe(2);
      expect(result?.summary).toBe("Second summary");
    });

    test("ignores compaction tool in non-output-available state", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "input-available",
              input: { summary: "Not yet complete" },
            } as any,
          ],
        },
      ];

      expect(findCompactionSummary(messages)).toBeNull();
    });

    test("returns preservedMessageIds when present in output", () => {
      const preservedIds = ["msg-4", "msg-5"];
      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: {
                summary: "Emergency summary",
                preservedMessageIds: preservedIds,
              },
            } as any,
          ],
        },
      ];

      const result = findCompactionSummary(messages);
      expect(result).not.toBeNull();
      expect(result?.preservedMessageIds).toEqual(preservedIds);
    });
  });

  describe("applyCompaction", () => {
    test("returns original messages when no compaction exists", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      const result = applyCompaction(messages);
      expect(result).toEqual(messages);
    });

    test("replaces messages before compaction with summary", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Old message 1" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Old response 1" }],
        },
        {
          id: "3",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: { summary: "Summary of old messages" },
            } as any,
          ],
        },
        {
          id: "4",
          role: "user",
          parts: [{ type: "text", text: "New message" }],
        },
      ];

      const result = applyCompaction(messages);

      // Should have: summary message + new message (compaction message excluded)
      expect(result.length).toBe(2);

      // First message should be the summary
      expect(result[0]?.id).toBe("compaction-summary");
      expect(result[0]?.role).toBe("user");
      expect(result[0]?.parts[0]?.type).toBe("text");
      expect((result[0]?.parts[0] as { text: string }).text).toInclude(
        "Summary of old messages"
      );

      // Should include messages after the compaction point (excluding compaction itself)
      expect(result[1]?.id).toBe("4");
    });

    test("keeps preserved messages by ID when preservedMessageIds is present", () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Old message 1" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Old response 1" }],
        },
        {
          id: "3",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: {
                summary: "Summary of old messages",
                preservedMessageIds: ["4", "5"], // Preserve specific messages
              },
            } as any,
          ],
        },
        {
          id: "4",
          role: "user",
          parts: [{ type: "text", text: "Preserved message 1" }],
        },
        {
          id: "5",
          role: "assistant",
          parts: [{ type: "text", text: "Preserved message 2" }],
        },
        {
          id: "6",
          role: "user",
          parts: [{ type: "text", text: "New message after compaction" }],
        },
      ];

      const result = applyCompaction(messages);

      // Should have: summary message + preserved messages (4, 5) + new message (6)
      // Compaction tool call (3) is excluded since summary already contains the info
      expect(result.length).toBe(4);

      // First message should be the summary
      expect(result[0]?.id).toBe("compaction-summary");
      expect((result[0]?.parts[0] as { text: string }).text).toInclude(
        "Summary of old messages"
      );

      // Should include messages after compaction point (excluding the compaction itself)
      expect(result[1]?.id).toBe("4");
      expect(result[2]?.id).toBe("5");
      expect(result[3]?.id).toBe("6"); // new message after compaction is preserved
    });
  });

  describe("createCompactionTool", () => {
    test("creates tool with correct name and schema", () => {
      const tools = createCompactionTool();

      expect(tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeDefined();
      expect(tools[COMPACT_CONVERSATION_TOOL_NAME].description).toInclude(
        "Compact the conversation history"
      );
    });

    test("tool execute returns summary in result", async () => {
      const tools = createCompactionTool();
      const compactionTool = tools[COMPACT_CONVERSATION_TOOL_NAME];

      const result = (await compactionTool.execute?.(
        { summary: "Test summary content" },
        { abortSignal: new AbortController().signal } as any
      )) as { summary: string; compacted_at: string; message: string };

      expect(result.summary).toBe("Test summary content");
      expect(result.compacted_at).toBeDefined();
      expect(result.message).toInclude("compacted");
    });

    test("tool execute includes preservedMessageIds when provided", async () => {
      const preservedIds = ["msg-4", "msg-5", "msg-6"];
      const tools = createCompactionTool(preservedIds);
      const compactionTool = tools[COMPACT_CONVERSATION_TOOL_NAME];

      const result = (await compactionTool.execute?.(
        { summary: "Emergency summary" },
        { abortSignal: new AbortController().signal } as any
      )) as {
        summary: string;
        compacted_at: string;
        message: string;
        preservedMessageIds?: string[];
      };

      expect(result.summary).toBe("Emergency summary");
      expect(result.preservedMessageIds).toEqual(preservedIds);
    });

    test("tool execute does not include preservedMessageIds when not provided", async () => {
      const tools = createCompactionTool();
      const compactionTool = tools[COMPACT_CONVERSATION_TOOL_NAME];

      const result = (await compactionTool.execute?.(
        { summary: "Normal summary" },
        { abortSignal: new AbortController().signal } as any
      )) as {
        summary: string;
        compacted_at: string;
        message: string;
        preservedMessageIds?: string[];
      };

      expect(result.preservedMessageIds).toBeUndefined();
    });
  });

  describe("createCompactionMessage", () => {
    test("creates compaction message with token info when provided", () => {
      const message = createCompactionMessage({
        tokenCount: 80000,
        threshold: 100000,
      });

      expect(message.id).toStartWith("compaction-request-");
      expect(message.role).toBe("user");
      const textPart = message.parts[0] as { text: string };
      expect(textPart.text).toInclude("80%");
      expect(textPart.text).toInclude("80,000");
      expect(textPart.text).toInclude("compact_conversation");
    });

    test("creates compaction message without token info when not provided", () => {
      const message = createCompactionMessage();

      expect(message.id).toStartWith("compaction-request-");
      expect(message.role).toBe("user");
      const textPart = message.parts[0] as { text: string };
      expect(textPart.text).toInclude("compact_conversation");
      expect(textPart.text).not.toInclude("%"); // No percentage
    });
  });

  describe("prepareTruncatedMessages", () => {
    test("returns empty arrays for empty messages", async () => {
      const result = await prepareTruncatedMessages({
        messages: [],
        tokenLimit: 1000,
        modelName: "anthropic/claude-sonnet-4",
      });

      expect(result.messagesToProcess).toEqual([]);
      expect(result.messagesToPreserve).toEqual([]);
    });

    test("includes all messages when under token limit", async () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Hi there!" }],
        },
      ];

      const result = await prepareTruncatedMessages({
        messages,
        tokenLimit: 100000, // Very high limit
        modelName: "anthropic/claude-sonnet-4",
      });

      expect(result.messagesToProcess.length).toBe(2);
      expect(result.messagesToPreserve.length).toBe(0);
    });

    test("truncates messages when over token limit", async () => {
      // Create messages with enough content to have measurable tokens
      const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [
          {
            type: "text",
            text: `This is message number ${i + 1} with some additional content to increase token count.`,
          },
        ],
      })) as Message[];

      const result = await prepareTruncatedMessages({
        messages,
        tokenLimit: 100, // Low limit to force truncation
        modelName: "anthropic/claude-sonnet-4",
      });

      // Should have truncated - not all messages in messagesToProcess
      expect(result.messagesToProcess.length).toBeLessThan(10);
      expect(result.messagesToProcess.length).toBeGreaterThan(0);

      // The rest should be in messagesToPreserve
      expect(
        result.messagesToProcess.length + result.messagesToPreserve.length
      ).toBe(10);

      // First message should be in messagesToProcess (oldest first)
      expect(result.messagesToProcess[0]?.id).toBe("1");
    });

    test("includes at least one message even if it exceeds token limit", async () => {
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [
            {
              type: "text",
              text: "This is a message with enough content to exceed a very small token limit.",
            },
          ],
        },
      ];

      const result = await prepareTruncatedMessages({
        messages,
        tokenLimit: 1, // Impossibly small limit
        modelName: "anthropic/claude-sonnet-4",
      });

      // Should still include the one message
      expect(result.messagesToProcess.length).toBe(1);
      expect(result.messagesToPreserve.length).toBe(0);
    });

  });

  describe("processCompaction", () => {
    const noopLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    test("returns empty compactionTool when under soft threshold", async () => {
      const { processCompaction } = await import("./compaction");

      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      const result = await processCompaction({
        messages,
        softTokenThreshold: 1_000_000, // Very high threshold
        hardTokenThreshold: 1_100_000,
        model: "anthropic/claude-sonnet-4",
        logger: noopLogger,
      });

      expect(result.messages).toEqual(messages);
      expect(Object.keys(result.compactionTool)).toHaveLength(0);
    });

    test("returns compactionTool when soft threshold exceeded", async () => {
      const { processCompaction } = await import("./compaction");

      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [
            { type: "text", text: "Hello world, this is a test message." },
          ],
        },
      ];

      const result = await processCompaction({
        messages,
        softTokenThreshold: 1, // Very low threshold
        hardTokenThreshold: 100_000, // High hard threshold so no truncation
        model: "anthropic/claude-sonnet-4",
        logger: noopLogger,
      });

      // Should have compaction tool
      expect(Object.keys(result.compactionTool)).toHaveLength(1);
      expect(
        result.compactionTool[COMPACT_CONVERSATION_TOOL_NAME]
      ).toBeDefined();

      // Should have injected compaction message
      expect(result.messages.length).toBe(2);
      const compactionRequest = result.messages.find((m) =>
        m.id.startsWith("compaction-request-")
      );
      expect(compactionRequest).toBeDefined();
    });

    test("applies existing compaction summary", async () => {
      const { processCompaction } = await import("./compaction");

      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Old message" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [
            {
              type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
              state: "output-available",
              output: { summary: "Summary of conversation" },
            } as any,
          ],
        },
        {
          id: "3",
          role: "user",
          parts: [{ type: "text", text: "New message" }],
        },
      ];

      const result = await processCompaction({
        messages,
        softTokenThreshold: 1_000_000, // High threshold so no new compaction
        hardTokenThreshold: 1_100_000,
        model: "anthropic/claude-sonnet-4",
        logger: noopLogger,
      });

      // Should have applied compaction (summary + new message, compaction tool call excluded)
      expect(result.messages.length).toBe(2);
      expect(result.messages[0]?.id).toBe("compaction-summary");
      expect(result.messages[1]?.id).toBe("3");
    });

    test("throws error when soft threshold >= hard threshold", async () => {
      const { processCompaction } = await import("./compaction");

      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      await expect(
        processCompaction({
          messages,
          softTokenThreshold: 100_000,
          hardTokenThreshold: 100_000, // Equal to soft - invalid
          model: "anthropic/claude-sonnet-4",
          logger: noopLogger,
        })
      ).rejects.toThrow("Soft token threshold");

      await expect(
        processCompaction({
          messages,
          softTokenThreshold: 200_000,
          hardTokenThreshold: 100_000, // Less than soft - invalid
          model: "anthropic/claude-sonnet-4",
          logger: noopLogger,
        })
      ).rejects.toThrow("Soft token threshold");
    });

    test("truncates messages at hard threshold and preserves rest", async () => {
      const { processCompaction } = await import("./compaction");

      // Create enough messages to exceed soft threshold but require truncation at hard
      // Each message is ~25 tokens, so 20 messages = ~500 tokens
      const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
        id: `${i + 1}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [
          {
            type: "text",
            text: `Message ${i + 1}: This is a longer message with additional content to generate more tokens for testing purposes.`,
          },
        ],
      })) as Message[];

      const result = await processCompaction({
        messages,
        softTokenThreshold: 1, // Trigger compaction immediately
        hardTokenThreshold: 300, // ~12 messages worth, forces truncation
        model: "anthropic/claude-sonnet-4",
        logger: noopLogger,
      });

      // Should have compaction tool with preserved message IDs
      expect(Object.keys(result.compactionTool)).toHaveLength(1);

      // Messages should be truncated (fewer than original 20 + compaction message)
      // With 300 token limit and ~25 tokens per message, expect ~12 messages + compaction = 13
      expect(result.messages.length).toBeLessThan(21);
      expect(result.messages.length).toBeGreaterThan(0);

      // Last message should be compaction request
      const lastMessage = result.messages[result.messages.length - 1];
      expect(lastMessage?.id).toMatch(/^compaction-request-/);
    });
  });
});
