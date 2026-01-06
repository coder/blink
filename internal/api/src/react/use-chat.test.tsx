import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { Window } from "happy-dom";
import type Client from "../client.browser";
import type { StreamChatEvent } from "../client.browser";
import { useChat } from "./use-chat";

beforeAll(() => {
  if (!globalThis.window) {
    const window = new Window({
      url: "http://localhost",
    });
    globalThis.window = window as any;
    globalThis.document = window.document as any;
    globalThis.HTMLElement = window.HTMLElement as any;
    globalThis.MutationObserver = window.MutationObserver as any;
    globalThis.getComputedStyle = window.getComputedStyle as any;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    };
    globalThis.cancelAnimationFrame = () => {};
  }
});

afterEach(() => {
  cleanup();
});

// Note: Not cleaning up window/document in afterAll to avoid
// potential issues with hanging cleanup in CI

// Mock client factory
function createMockClient() {
  const mockClient = {
    chats: {
      create: mock(),
      stream: mock(),
      stop: mock(),
    },
    messages: {
      send: mock(),
    },
  } as unknown as Client;

  return mockClient;
}

// Helper to create async iterable stream
function createMockStream(
  events: StreamChatEvent[]
): AsyncIterable<StreamChatEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    cancel: async () => {},
  } as any;
}

describe("useChat", () => {
  it("initializes with empty messages", () => {
    const client = createMockClient();
    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
      })
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeUndefined();
  });

  it("initializes with provided messages", () => {
    const client = createMockClient();
    const initialMessages: UIMessage[] = [
      {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
        messages: initialMessages,
      })
    );

    expect(result.current.messages).toEqual(initialMessages);
  });

  it("sends a message and creates a chat", async () => {
    const client = createMockClient();
    const mockStream = createMockStream([]);

    client.chats.create.mockResolvedValue({
      id: "chat-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
      stream: mockStream,
    });

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
      })
    );

    await result.current.sendMessage({ text: "Hello" });

    await waitFor(() => {
      expect(result.current.id).toBe("chat-1");
      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].parts[0]).toEqual({
        type: "text",
        text: "Hello",
      });
    });
  });

  it("handles message.created events", async () => {
    const client = createMockClient();
    const mockStream = createMockStream([
      {
        event: "message.created",
        data: {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Hi there!" }],
        },
      },
    ]);

    client.chats.stream.mockResolvedValue(mockStream);

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
        id: "chat-1",
      })
    );

    await waitFor(
      () => {
        expect(result.current.messages.length).toBe(1);
      },
      { timeout: 1000 }
    );

    expect(result.current.messages[0].id).toBe("msg-2");
    expect(result.current.messages[0].role).toBe("assistant");
  });

  // Race condition test 1: Concurrent message chunks
  it("handles concurrent message chunks without corruption", async () => {
    const client = createMockClient();
    const chunks: StreamChatEvent[] = [];

    // Create 10 messages with 5 chunks each, interleaved
    for (let i = 0; i < 5; i++) {
      for (let msgIdx = 0; msgIdx < 10; msgIdx++) {
        chunks.push({
          event: "message.chunk.added",
          data: {
            id: `msg-${msgIdx}`,
            chunk: {
              type: "text-delta",
              textDelta: `chunk${i}-`,
            } as UIMessageChunk,
          },
        });
      }
    }

    // Add message.created events to close streams
    for (let msgIdx = 0; msgIdx < 10; msgIdx++) {
      chunks.push({
        event: "message.created",
        data: {
          id: `msg-${msgIdx}`,
          role: "assistant",
          parts: [{ type: "text", text: `Message ${msgIdx}` }],
        },
      });
    }

    const mockStream = createMockStream(chunks);
    client.chats.stream.mockResolvedValue(mockStream);

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
        id: "chat-1",
      })
    );

    await waitFor(
      () => {
        expect(result.current.messages.length).toBe(10);
      },
      { timeout: 2000 }
    );

    // Verify all messages are present with correct IDs
    const messageIds = result.current.messages.map((m) => m.id).sort();
    expect(messageIds).toEqual([
      "msg-0",
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
      "msg-5",
      "msg-6",
      "msg-7",
      "msg-8",
      "msg-9",
    ]);
  });

  // Race condition test 2: Submit while streaming
  it("handles submit while streaming without losing messages", async () => {
    const client = createMockClient();

    // Initial stream with ongoing chunks
    const initialStream = createMockStream([
      {
        event: "message.chunk.added",
        data: {
          id: "msg-1",
          chunk: { type: "text-delta", textDelta: "Hello" } as UIMessageChunk,
        },
      },
    ]);

    client.chats.create.mockResolvedValueOnce({
      id: "chat-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "First" }],
        },
      ],
      stream: initialStream,
    });

    client.messages.send.mockResolvedValueOnce({
      messages: [
        {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "Second" }],
        },
      ],
    });

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
      })
    );

    // Send first message
    await result.current.sendMessage({ text: "First" });

    await waitFor(() => {
      expect(result.current.id).toBe("chat-1");
    });

    // Send second message while first is streaming
    await result.current.sendMessage({ text: "Second" });

    await waitFor(() => {
      // Should have both user messages
      const userMessages = result.current.messages.filter(
        (m) => m.role === "user"
      );
      expect(userMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  // Race condition test 3: Rapid status changes
  it("handles rapid status changes correctly", async () => {
    const client = createMockClient();
    const mockStream = createMockStream([
      { event: "chat.updated", data: { status: "streaming" } },
      { event: "chat.updated", data: { status: "idle" } },
      { event: "chat.updated", data: { status: "streaming" } },
      { event: "chat.updated", data: { status: "idle" } },
    ]);

    client.chats.stream.mockResolvedValue(mockStream);

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
        id: "chat-1",
      })
    );

    await waitFor(
      () => {
        expect(result.current.status).toBe("ready");
      },
      { timeout: 1000 }
    );

    expect(result.current.error).toBeUndefined();
  });

  // Race condition test 4: Message deduplication during submit
  it("deduplicates messages when response arrives before stream", async () => {
    const client = createMockClient();

    // Response contains a message that will also come via stream
    client.chats.create.mockResolvedValueOnce({
      id: "chat-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Response" }],
        },
      ],
      stream: createMockStream([
        {
          event: "message.created",
          data: {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Response" }],
          },
        },
      ]),
    });

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
      })
    );

    await result.current.sendMessage({ text: "Hello" });

    await waitFor(
      () => {
        expect(result.current.messages.length).toBe(2);
      },
      { timeout: 1000 }
    );

    // Should have exactly 2 messages, no duplicates
    const assistantMessages = result.current.messages.filter(
      (m) => m.id === "assistant-1"
    );
    expect(assistantMessages.length).toBe(1);
  });

  // Race condition test 5: Multiple message.created for same ID
  it("handles multiple message.created events for same ID", async () => {
    const client = createMockClient();
    const mockStream = createMockStream([
      {
        event: "message.created",
        data: {
          id: "msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "First version" }],
        },
      },
      {
        event: "message.created",
        data: {
          id: "msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "Second version" }],
        },
      },
    ]);

    client.chats.stream.mockResolvedValue(mockStream);

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
        id: "chat-1",
      })
    );

    await waitFor(
      () => {
        expect(result.current.messages.length).toBe(1);
      },
      { timeout: 1000 }
    );

    // Should only have one message (no duplicates)
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].id).toBe("msg-1");
  });

  it("stops chat correctly", async () => {
    const client = createMockClient();
    client.chats.stop.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
        id: "chat-1",
      })
    );

    await result.current.stop();

    expect(client.chats.stop).toHaveBeenCalledWith("chat-1");
    expect(result.current.status).toBe("ready");
  });

  it("clears error", () => {
    const client = createMockClient();
    const { result, rerender } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
      })
    );

    // Manually set error for testing
    result.current.clearError();
    rerender();

    expect(result.current.error).toBeUndefined();
  });

  // Bug reproduction: Pre-inserted message not removed when stream delivers the real message
  it("does not duplicate user message when stream delivers it after empty response", async () => {
    const client = createMockClient();

    // Simulate streaming new chat: server returns empty messages array,
    // and the user's message arrives via stream with a server-assigned ID
    const serverAssignedUserId = "server-user-msg-1";

    client.chats.create.mockResolvedValueOnce({
      id: "chat-1",
      messages: [], // Empty! Messages will come via stream for streaming chats
      stream: createMockStream([
        // The server sends back the user's message with its own ID
        {
          event: "message.created",
          data: {
            id: serverAssignedUserId,
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        },
        // Then the assistant responds
        {
          event: "message.created",
          data: {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Hi there!" }],
          },
        },
      ]),
    });

    const { result } = renderHook(() =>
      useChat({
        organization: "org-1",
        agent: "agent-1",
        client,
      })
    );

    // Send a message - this will pre-insert with a temporary UUID
    await result.current.sendMessage({ text: "Hello" });

    // Wait for stream to process
    await waitFor(
      () => {
        expect(result.current.messages.length).toBe(2);
      },
      { timeout: 2000 }
    );

    // CRITICAL ASSERTION: There should be exactly 1 user message, not 2
    // The bug causes 2 user messages: one pre-inserted (temp UUID) + one from stream (server ID)
    const userMessages = result.current.messages.filter(
      (m) => m.role === "user"
    );
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].id).toBe(serverAssignedUserId);

    // And exactly 1 assistant message
    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant"
    );
    expect(assistantMessages.length).toBe(1);
  });
});
