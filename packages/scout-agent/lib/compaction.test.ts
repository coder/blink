/** biome-ignore-all lint/style/noNonNullAssertion: fine for tests */
/** biome-ignore-all lint/suspicious/noExplicitAny: fine for tests */
import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import {
  applyCompactionToMessages,
  buildCompactionRequestMessage,
  COMPACT_CONVERSATION_TOOL_NAME,
  COMPACTION_MARKER_TOOL_NAME,
  countCompactionMarkers,
  maxConsecutiveCompactionAttempts,
  createCompactionMarkerPart,
  createCompactionTool,
  findAPICallError,
  findCompactionSummary,
  isOutOfContextError,
  MAX_CONSECUTIVE_COMPACTION_ATTEMPTS,
} from "./compaction";
import type { Message } from "./types";

// Test helpers to reduce duplication
function userMsg(id: string, text: string): Message {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMsg(id: string, text: string): Message {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function markerMsg(id: string): Message {
  return {
    id,
    role: "assistant",
    parts: [createCompactionMarkerPart() as Message["parts"][number]],
  };
}

function summaryPart(
  summary: string,
  compactedAt = "2024-01-01T00:00:00Z",
  toolCallId = "test"
): Message["parts"][number] {
  return {
    type: "dynamic-tool",
    toolName: COMPACT_CONVERSATION_TOOL_NAME,
    toolCallId,
    state: "output-available",
    input: { summary: "Test" },
    output: { summary, compacted_at: compactedAt },
  } as Message["parts"][number];
}

function summaryMsg(
  id: string,
  summary: string,
  compactedAt = "2024-01-01T00:00:00Z"
): Message {
  return { id, role: "assistant", parts: [summaryPart(summary, compactedAt)] };
}

describe("isOutOfContextError", () => {
  const createApiError = (message: string) =>
    new APICallError({
      message,
      url: "https://api.example.com",
      requestBodyValues: {},
      statusCode: 400,
    });

  test("returns true for APICallError with context limit message", () => {
    expect(
      isOutOfContextError(
        createApiError("Input is too long for requested model")
      )
    ).toBe(true);
    expect(isOutOfContextError(createApiError("context_length_exceeded"))).toBe(
      true
    );
  });

  test("returns true for APICallError in cause chain", () => {
    const apiError = createApiError("max_tokens_exceeded");
    const wrapper = new Error("Gateway error");
    (wrapper as { cause?: unknown }).cause = apiError;
    expect(isOutOfContextError(wrapper)).toBe(true);
  });

  test("returns false for APICallError with unrelated message", () => {
    expect(isOutOfContextError(createApiError("authentication failed"))).toBe(
      false
    );
  });

  test("returns false for non-APICallError even if message matches pattern", () => {
    expect(isOutOfContextError(new Error("context_length_exceeded"))).toBe(
      false
    );
    expect(isOutOfContextError("input too long")).toBe(false);
  });
});

describe("findAPICallError", () => {
  const createApiError = (message: string) =>
    new APICallError({
      message,
      url: "https://api.example.com",
      requestBodyValues: {},
      statusCode: 400,
    });

  test("returns the APICallError when provided directly", () => {
    const error = createApiError("test");
    expect(findAPICallError(error)).toBe(error);
  });

  test("returns APICallError from single-level cause", () => {
    const apiError = createApiError("test");
    const wrapper = new Error("wrapper");
    (wrapper as { cause?: unknown }).cause = apiError;
    expect(findAPICallError(wrapper)).toBe(apiError);
  });

  test("returns APICallError from deep cause chain", () => {
    const apiError = createApiError("test");
    const wrapper = { cause: { cause: apiError } };
    expect(findAPICallError(wrapper)).toBe(apiError);
  });

  test("returns null when no APICallError present", () => {
    expect(findAPICallError(new Error("other"))).toBeNull();
    expect(findAPICallError("string")).toBeNull();
    expect(findAPICallError(null)).toBeNull();
  });
});

describe("createCompactionTool", () => {
  test("tool has correct name", () => {
    const tools = createCompactionTool();
    expect(tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeDefined();
  });

  test("tool has description", () => {
    const tools = createCompactionTool();
    const tool = tools[COMPACT_CONVERSATION_TOOL_NAME];
    expect(tool.description).toBeDefined();
    expect(tool.description?.length).toBeGreaterThan(0);
  });

  test("execute returns correct format with timestamp", async () => {
    const tools = createCompactionTool();
    const tool = tools[COMPACT_CONVERSATION_TOOL_NAME];

    const result = await tool.execute!(
      { summary: "Test summary" },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "test-call-id",
        messages: [],
      }
    );

    expect(result).toHaveProperty("summary", "Test summary");
    expect(result).toHaveProperty("compacted_at");
    expect(result).toHaveProperty("message");
    expect(typeof result.compacted_at).toBe("string");
  });
});

describe("createCompactionMarkerPart", () => {
  test("creates valid tool call part structure", () => {
    const part = createCompactionMarkerPart();

    expect(part.type).toBe("dynamic-tool");
    expect(part.toolName).toBe(COMPACTION_MARKER_TOOL_NAME);
    expect(part.state).toBe("output-available");
    expect(part.input).toBeDefined();
    expect(part.output).toBeDefined();
  });

  test("has unique toolCallId", () => {
    const part1 = createCompactionMarkerPart();
    const part2 = createCompactionMarkerPart();

    expect(part1.toolCallId).not.toBe(part2.toolCallId);
    expect(part1.toolCallId).toMatch(/^compaction-marker-/);
  });

  test("includes model_intent in input", () => {
    const part = createCompactionMarkerPart();

    expect(part.input.model_intent).toBe(
      "Out of context, compaction in progress..."
    );
  });
});

describe("findCompactionSummary", () => {
  test("returns null when no summary exists", () => {
    const messages: Message[] = [
      userMsg("1", "Hello"),
      assistantMsg("2", "Hi there"),
    ];
    expect(findCompactionSummary(messages)).toBeNull();
  });

  test("finds successful compact_conversation result (dynamic-tool)", () => {
    const messages: Message[] = [
      userMsg("1", "Hello"),
      summaryMsg("2", "This is the summary"),
    ];

    const result = findCompactionSummary(messages);

    expect(result).not.toBeNull();
    expect(result?.summary).toBe("This is the summary");
    expect(result?.compactedAt).toBe("2024-01-01T00:00:00Z");
    expect(result?.messageIndex).toBe(1);
  });

  test("finds successful compact_conversation result (typed tool)", () => {
    const messages: Message[] = [
      userMsg("1", "Hello"),
      {
        id: "2",
        role: "assistant",
        parts: [
          {
            type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
            toolCallId: "test-call",
            state: "output-available",
            input: { summary: "Test" },
            output: {
              summary: "Typed summary",
              compacted_at: "2024-01-02T00:00:00Z",
            },
          } as Message["parts"][number],
        ],
      },
    ];

    const result = findCompactionSummary(messages);

    expect(result).not.toBeNull();
    expect(result?.summary).toBe("Typed summary");
  });

  test("returns null for incomplete tool calls", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: COMPACT_CONVERSATION_TOOL_NAME,
            toolCallId: "test-call",
            state: "input-available",
            input: { summary: "Test" },
          } as Message["parts"][number],
        ],
      },
    ];

    expect(findCompactionSummary(messages)).toBeNull();
  });
});

describe("countCompactionMarkers", () => {
  test("returns 0 when no markers exist", () => {
    const messages: Message[] = [
      userMsg("1", "Hello"),
      assistantMsg("2", "Hi there"),
    ];
    expect(countCompactionMarkers(messages)).toBe(0);
  });

  test("returns 1 for a single marker", () => {
    const messages: Message[] = [userMsg("1", "Hello"), markerMsg("2")];
    expect(countCompactionMarkers(messages)).toBe(1);
  });

  test("counts multiple markers", () => {
    const messages: Message[] = [
      markerMsg("1"),
      userMsg("2", "test"),
      markerMsg("3"),
      userMsg("4", "test"),
      markerMsg("5"),
    ];

    expect(countCompactionMarkers(messages)).toBe(3);
  });

  test("stops counting at compaction summary", () => {
    const messages: Message[] = [
      markerMsg("1"),
      summaryMsg("2", "Summary"),
      userMsg("3", "test"),
      markerMsg("4"),
    ];

    // Should only count marker4, not marker1 (which is before the summary)
    expect(countCompactionMarkers(messages)).toBe(1);
  });
});

describe("maxConsecutiveCompactionAttempts", () => {
  test("counts consecutive assistant compaction attempts", () => {
    const messages: Message[] = [
      userMsg("1", "Hello"),
      summaryMsg("summary-1", "Summary output 1"),
      summaryMsg("summary-2", "Summary output 2"),
    ];

    expect(maxConsecutiveCompactionAttempts(messages)).toBe(2);
  });

  test("does not count non-consecutive compaction attempts", () => {
    const messages: Message[] = [
      summaryMsg("summary-1", "First summary"),
      userMsg("1", "Hello"),
      summaryMsg("summary-2", "Second summary"),
    ];

    expect(maxConsecutiveCompactionAttempts(messages)).toBe(1);
  });

  test("stops at non-compaction assistant message", () => {
    const messages: Message[] = [
      markerMsg("marker1"),
      assistantMsg("assistant", "Normal reply"),
    ];

    expect(maxConsecutiveCompactionAttempts(messages)).toBe(0);
  });
});

describe("buildCompactionRequestMessage", () => {
  test("creates user message with correct role", () => {
    const message = buildCompactionRequestMessage();

    expect(message.role).toBe("user");
  });

  test("includes context limit notice", () => {
    const message = buildCompactionRequestMessage();
    const textPart = message.parts[0] as { type: "text"; text: string };

    expect(textPart.text).toContain("SYSTEM NOTICE - CONTEXT LIMIT");
    expect(textPart.text).toContain("compact_conversation");
  });
});

describe("applyCompactionToMessages", () => {
  test("returns unchanged messages when no compaction state", () => {
    const messages: Message[] = [
      userMsg("1", "Hello"),
      assistantMsg("2", "Hi there"),
    ];
    const result = applyCompactionToMessages(messages);
    expect(result).toEqual(messages);
  });

  test("throws when consecutive compaction attempts hit the limit", () => {
    const attempts = MAX_CONSECUTIVE_COMPACTION_ATTEMPTS + 1;
    const messages: Message[] = [
      userMsg("1", "Hello"),
      ...Array.from({ length: attempts }, (_, idx) =>
        summaryMsg(`summary-${idx}`, `Summary ${idx}`)
      ),
    ];

    expect(() => applyCompactionToMessages(messages)).toThrow(
      /Compaction loop detected/
    );
  });

  test("excludes correct number of messages based on marker count", () => {
    const messages: Message[] = [
      userMsg("1", "Message 1"),
      userMsg("2", "Message 2"),
      assistantMsg("2-assistant", "Response 2"),
      assistantMsg("2-assistant2", "Response 2b"),
      userMsg("3", "Message 3"),
      markerMsg("marker"),
    ];

    const result = applyCompactionToMessages(messages);
    const ids = result.map((m) => m.id);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("2-assistant");
    expect(ids).toContain("2-assistant2");
    expect(ids).not.toContain("3");

    // With two markers, excludes two user turns
    const result2 = applyCompactionToMessages([
      ...messages,
      markerMsg("marker2"),
    ]);
    const ids2 = result2.map((m) => m.id);
    expect(ids2).toContain("1");
    expect(ids2).not.toContain("2");
    expect(ids2).not.toContain("2-assistant");
    expect(ids2).not.toContain("2-assistant2");
    expect(ids2).not.toContain("3");
  });

  test("excludes compaction markers", () => {
    const messages: Message[] = [
      userMsg("1", "Message 1"),
      userMsg("2", "Message 2"),
      userMsg("3", "Message 3"),
      markerMsg("marker"),
      markerMsg("marker2"),
    ];

    const result = applyCompactionToMessages(messages);
    const ids = result.map((m) => m.id);
    expect(ids).toContain("1");
    expect(ids).not.toContain("marker");
    expect(ids).not.toContain("marker2");
  });

  test("injects compaction request when marker found", () => {
    const messages: Message[] = [
      userMsg("1", "Message 1"),
      userMsg("2", "Message 2"),
      userMsg("3", "Message 3"),
      markerMsg("marker"),
    ];

    const result = applyCompactionToMessages(messages);
    const lastMessage = result[result.length - 1];

    expect(lastMessage?.role).toBe("user");
    expect(lastMessage?.parts[0]?.type).toBe("text");
    expect((lastMessage?.parts[0] as any).text).toContain(
      "compact_conversation"
    );
  });

  test("replaces old messages with summary and excluded messages when compaction complete", () => {
    const messages: Message[] = [
      userMsg("kept", "Will be summarized"),
      userMsg("excluded-1", "Will be excluded and restored"),
      assistantMsg("excluded-1-assistant", "Will be excluded and restored"),
      markerMsg("marker-msg"),
      summaryMsg("summary-msg", "Summary"),
      userMsg("after-summary", "After"),
    ];

    const result = applyCompactionToMessages(messages);
    const ids = result.map((m) => m.id);
    expect(ids).not.toContain("kept");
    expect(ids).toContain("excluded-1");
    expect(ids).toContain("excluded-1-assistant");
    expect(ids).not.toContain("marker-msg");
    expect(ids).not.toContain("summary-msg");
    expect(ids).toContain("after-summary");
  });

  test("throws error when would summarize <= 1 message", () => {
    const messages: Message[] = [userMsg("1", "M1"), markerMsg("marker")];
    expect(() => applyCompactionToMessages(messages)).toThrow(/Cannot compact/);
  });

  test("uses only the most recent summary when multiple summaries exist", () => {
    const messages: Message[] = [
      summaryMsg("old-summary", "Old summary content", "2024-01-01T00:00:00Z"),
      userMsg("between-summaries", "Message between summaries"),
      summaryMsg("new-summary", "New summary content", "2024-01-02T00:00:00Z"),
      userMsg("after-new-summary", "After new summary"),
    ];

    const result = applyCompactionToMessages(messages);

    // Old summary should be discarded
    const ids = result.map((m) => m.id);
    expect(ids).not.toContain("old-summary");
    expect(ids).not.toContain("new-summary");
    expect(ids).toContain("after-new-summary");

    // First message should be the summary message with the NEW summary content
    const firstMessage = result[0];
    expect(firstMessage?.role).toBe("user");
    expect((firstMessage?.parts[0] as any).text).toContain(
      "New summary content"
    );
    expect((firstMessage?.parts[0] as any).text).toContain("2024-01-02");
  });

  test("handles re-compaction after a summary (summary followed by new markers)", () => {
    const messages: Message[] = [
      summaryMsg("summary", "First compaction summary"),
      userMsg("after-summary-1", "Continued conversation"),
      userMsg("after-summary-2", "More conversation"),
      markerMsg("new-marker"),
    ];

    const result = applyCompactionToMessages(messages);

    // Should have summary messages at start, then kept messages, then compaction request
    const ids = result.map((m) => m.id);
    expect(ids).not.toContain("summary");
    expect(ids).not.toContain("new-marker");

    // Should include the first after-summary message (excluded one user turn)
    expect(ids).toContain("after-summary-1");
    expect(ids).not.toContain("after-summary-2");

    // Last message should be compaction request
    const lastMessage = result[result.length - 1];
    expect(lastMessage?.role).toBe("user");
    expect((lastMessage?.parts[0] as any).text).toContain(
      "compact_conversation"
    );
  });

  test("handles summary with zero markers before it", () => {
    // This can happen if a summary was manually added or from a previous session
    const messages: Message[] = [
      userMsg("old-content", "Old content"),
      summaryMsg("summary", "Summary with no markers"),
      userMsg("after-summary", "After summary"),
    ];

    const result = applyCompactionToMessages(messages);

    const ids = result.map((m) => m.id);
    // Old content should be replaced by summary
    expect(ids).not.toContain("old-content");
    expect(ids).not.toContain("summary");
    expect(ids).toContain("after-summary");

    // No excluded messages to restore (markerCount was 0)
    // So result should be: summary messages + after-summary
    expect(result.length).toBe(3); // user summary + assistant ack + after-summary
  });

  test("throws error when marker count exceeds available user messages", () => {
    // 3 markers but only 2 user messages
    const messages: Message[] = [
      userMsg("1", "M1"),
      markerMsg("marker1"),
      userMsg("2", "M2"),
      markerMsg("marker2"),
      markerMsg("marker3"),
    ];

    // With 3 markers, it tries to exclude 3 user turns, but there are only 2
    // This should cause excludedMessagesStartIndex to be 0, triggering CompactionError
    expect(() => applyCompactionToMessages(messages)).toThrow(/Cannot compact/);
  });

  test("output structure starts with summary messages when summary is applied", () => {
    const messages: Message[] = [
      userMsg("old", "Old message"),
      markerMsg("marker"),
      summaryMsg("summary", "The summary content"),
      userMsg("after", "After"),
    ];

    const result = applyCompactionToMessages(messages);

    // First message: user message with summary
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.id).toBe("compaction-summary");
    expect((result[0]?.parts[0] as any).text).toContain("CONVERSATION SUMMARY");
    expect((result[0]?.parts[0] as any).text).toContain("The summary content");

    // Second message: assistant acknowledgment
    expect(result[1]?.role).toBe("assistant");
    expect(result[1]?.id).toBe("compaction-summary-response");
    expect((result[1]?.parts[0] as any).text).toBe("Acknowledged.");
  });

  test("handles typed tool format for markers", () => {
    const messages: Message[] = [
      userMsg("1", "M1"),
      userMsg("2", "M2"),
      {
        id: "marker",
        role: "assistant",
        parts: [
          {
            type: `tool-${COMPACTION_MARKER_TOOL_NAME}`,
            toolCallId: "typed-marker",
            state: "output-available",
            input: { model_intent: "test" },
            output: "marker output",
          } as Message["parts"][number],
        ],
      },
    ];

    const result = applyCompactionToMessages(messages);

    // Should recognize the typed format and process it
    const ids = result.map((m) => m.id);
    expect(ids).toContain("1");
    expect(ids).not.toContain("2"); // excluded
    expect(ids).not.toContain("marker");

    // Should inject compaction request
    const lastMessage = result[result.length - 1];
    expect((lastMessage?.parts[0] as any).text).toContain(
      "compact_conversation"
    );
  });

  test("filters out marker parts from messages with mixed content", () => {
    const markerPart = createCompactionMarkerPart();
    const messages: Message[] = [
      userMsg("1", "M1"),
      userMsg("2", "M2"),
      {
        id: "mixed",
        role: "assistant",
        parts: [
          { type: "text", text: "Some text" },
          markerPart as Message["parts"][number],
        ],
      },
    ];

    const result = applyCompactionToMessages(messages);

    // The message with mixed content should be filtered out entirely
    // (because it contains a marker part)
    const ids = result.map((m) => m.id);
    expect(ids).not.toContain("mixed");
  });

  test("returns empty array for empty messages", () => {
    const result = applyCompactionToMessages([]);
    expect(result).toEqual([]);
  });

  test("preserves user message added after markers once summary is generated", () => {
    // Scenario: compaction was in progress (markers present), user interrupted with a new message,
    // then the model produced a summary. The new user message should be preserved.
    const messages: Message[] = [
      userMsg("1", "First message"),
      userMsg("2", "Second message"),
      userMsg("3", "Third message"),
      userMsg("4", "Fourth message"),
      markerMsg("marker1"),
      assistantMsg(
        "assistant-buffer",
        "Normal reply between compaction attempts"
      ),
      markerMsg("marker2"),
      userMsg("interrupted", "User interrupted compaction with this message"),
      markerMsg("marker3"),
      summaryMsg("summary", "Summary of the conversation"),
    ];

    const result = applyCompactionToMessages(messages);

    const ids = result.map((m) => m.id);
    // Earlier messages should be replaced by summary
    expect(ids).not.toContain("1");
    expect(ids).not.toContain("2");
    // Messages excluded during compaction request should be restored
    expect(ids).toContain("3");
    expect(ids).toContain("4");
    expect(ids).toContain("interrupted"); // The interrupted user message is preserved
    // Markers and summary message itself should be gone
    expect(ids).not.toContain("marker1");
    expect(ids).not.toContain("marker2");
    expect(ids).not.toContain("marker3");
    expect(ids).not.toContain("summary");
    // Should start with summary messages
    expect(result[0]?.id).toBe("compaction-summary");
  });
});
