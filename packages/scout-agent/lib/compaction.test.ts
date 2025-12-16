import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import type { Message } from "./types";
import {
  COMPACT_CONVERSATION_TOOL_NAME,
  applyCompaction,
  calculateEmergencyCompactionConfig,
  createCompactionTool,
  createCompactionWarningMessage,
  createEmergencyCompactionMessage,
  findCompactionSummary,
  isContextLengthError,
  prepareEmergencyCompactionMessages,
} from "./compaction";

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

      // Should have: summary message + compaction message + new message
      expect(result.length).toBe(3);

      // First message should be the summary
      expect(result[0].id).toBe("compaction-summary");
      expect(result[0].role).toBe("user");
      expect(result[0].parts[0].type).toBe("text");
      expect((result[0].parts[0] as { text: string }).text).toInclude(
        "Summary of old messages"
      );

      // Should include messages from compaction point onwards
      expect(result[1].id).toBe("3");
      expect(result[2].id).toBe("4");
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

      const result = (await compactionTool.execute(
        { summary: "Test summary content" },
        { abortSignal: new AbortController().signal } as any
      )) as { summary: string; compacted_at: string; message: string };

      expect(result.summary).toBe("Test summary content");
      expect(result.compacted_at).toBeDefined();
      expect(result.message).toInclude("compacted");
    });
  });

  describe("createCompactionWarningMessage", () => {
    test("creates warning message with token info", () => {
      const message = createCompactionWarningMessage(80000, 100000);

      expect(message.id).toBe("compaction-warning");
      expect(message.role).toBe("user");
      const textPart = message.parts[0] as { text: string };
      expect(textPart.text).toInclude("80%");
      expect(textPart.text).toInclude("80,000");
      expect(textPart.text).toInclude("compact_conversation");
    });
  });

  describe("isContextLengthError", () => {
    test("returns false for null/undefined", () => {
      expect(isContextLengthError(null)).toBe(false);
      expect(isContextLengthError(undefined)).toBe(false);
    });

    test("detects context length exceeded in Error message", () => {
      expect(
        isContextLengthError(new Error("context length exceeded"))
      ).toBe(true);
      expect(
        isContextLengthError(new Error("maximum context length reached"))
      ).toBe(true);
      expect(isContextLengthError(new Error("token limit exceeded"))).toBe(
        true
      );
      expect(isContextLengthError(new Error("too many tokens in request"))).toBe(
        true
      );
      expect(isContextLengthError(new Error("input too long"))).toBe(true);
      expect(isContextLengthError(new Error("prompt too long"))).toBe(true);
      expect(isContextLengthError(new Error("context_length_exceeded"))).toBe(
        true
      );
    });

    test("detects context length error in string", () => {
      expect(isContextLengthError("context length exceeded")).toBe(true);
      expect(isContextLengthError("token limit exceeded")).toBe(true);
    });

    test("returns false for unrelated errors", () => {
      expect(isContextLengthError(new Error("Network error"))).toBe(false);
      expect(isContextLengthError(new Error("Rate limited"))).toBe(false);
      expect(isContextLengthError("Something went wrong")).toBe(false);
    });

    test("detects APICallError with context length message", () => {
      const apiError = new APICallError({
        message: "context length exceeded",
        url: "https://api.example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseBody: "error details",
      });

      expect(isContextLengthError(apiError)).toBe(true);
    });

    test("detects APICallError with context length in response body", () => {
      const apiError = new APICallError({
        message: "Request failed",
        url: "https://api.example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseBody: '{"error": "context_length_exceeded"}',
      });

      expect(isContextLengthError(apiError)).toBe(true);
    });
  });

  describe("calculateEmergencyCompactionConfig", () => {
    test("first attempt keeps 20% of messages (max 10)", () => {
      const config = calculateEmergencyCompactionConfig(50);

      expect(config.totalMessages).toBe(50);
      expect(config.recentMessagesToKeep).toBe(10); // 20% of 50, capped at 10
    });

    test("first attempt with small message count", () => {
      const config = calculateEmergencyCompactionConfig(20);

      expect(config.totalMessages).toBe(20);
      expect(config.recentMessagesToKeep).toBe(4); // 20% of 20
    });

    test("subsequent attempt reduces messages to summarize by half", () => {
      const config = calculateEmergencyCompactionConfig(50, 10);

      // Previous attempt had 10 preserved, so 40 were summarized
      // New attempt: summarize half of 40 = 20, keep 30
      expect(config.recentMessagesToKeep).toBe(30);
    });

    test("keeps at least 5 messages", () => {
      const config = calculateEmergencyCompactionConfig(10, 8);

      expect(config.recentMessagesToKeep).toBeGreaterThanOrEqual(5);
    });
  });

  describe("createEmergencyCompactionMessage", () => {
    test("creates message with correct counts", () => {
      const config = { totalMessages: 50, recentMessagesToKeep: 10 };
      const message = createEmergencyCompactionMessage(config);

      expect(message.id).toBe("emergency-compaction-request");
      expect(message.role).toBe("user");
      const textPart = message.parts[0] as { text: string };
      expect(textPart.text).toInclude("first 40 messages");
      expect(textPart.text).toInclude("10 most recent");
    });
  });

  describe("prepareEmergencyCompactionMessages", () => {
    test("splits messages correctly", () => {
      const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `Message ${i + 1}` }],
      })) as Message[];

      const config = { totalMessages: 10, recentMessagesToKeep: 3 };
      const { messagesToProcess, messagesToPreserve } =
        prepareEmergencyCompactionMessages(messages, config);

      expect(messagesToProcess.length).toBe(7);
      expect(messagesToPreserve.length).toBe(3);

      // Check that the split is correct
      expect(messagesToProcess[0]!.id).toBe("1");
      expect(messagesToProcess[6]!.id).toBe("7");
      expect(messagesToPreserve[0]!.id).toBe("8");
      expect(messagesToPreserve[2]!.id).toBe("10");
    });
  });
});
