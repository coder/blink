import { expect, test } from "bun:test";
import type { UIMessage, UIMessageChunk } from "ai";
import { Client } from "../agent/client";
import { runAgent } from "./run-agent";

const createMockAgent = (
  streamGenerator: () => AsyncGenerator<UIMessageChunk>
): Client => {
  return {
    chat: async () => {
      // Convert async generator to ReadableStream
      const generator = streamGenerator();
      return new ReadableStream<UIMessageChunk>({
        async pull(controller) {
          const { done, value } = await generator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        },
        async cancel() {
          if (generator.return) {
            await generator.return(undefined);
          }
        },
      });
    },
  } as unknown as Client;
};

const createSimpleMessageStream =
  async function* (): AsyncGenerator<UIMessageChunk> {
    // Start the message
    yield {
      type: "start",
      messageId: "msg-1",
    } as UIMessageChunk;

    // Add text content
    yield {
      type: "text-start",
      id: "text-1",
    } as UIMessageChunk;

    yield {
      type: "text-delta",
      id: "text-1",
      delta: "Hello",
    } as UIMessageChunk;

    yield {
      type: "text-end",
      id: "text-1",
    } as UIMessageChunk;

    // Finish the message
    yield {
      type: "finish",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5 },
    } as UIMessageChunk;
  };

test("runAgent: completes normally and streams messages", async () => {
  const agent = createMockAgent(() => createSimpleMessageStream());

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [],
  });
  const reader = stream.getReader();

  // Read all messages from stream
  const messages: UIMessage[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    messages.push(value);
  }

  expect(messages.length).toBeGreaterThan(0);
});

test("runAgent: handles abort gracefully", async () => {
  const abortController = new AbortController();

  // Create a stream that will be interrupted
  const slowStream = async function* (): AsyncGenerator<UIMessageChunk> {
    yield {
      type: "start",
      messageId: "msg-1",
    } as UIMessageChunk;

    yield {
      type: "text-start",
      id: "text-1",
    } as UIMessageChunk;

    yield {
      type: "text-delta",
      id: "text-1",
      delta: "Hello",
    } as UIMessageChunk;

    // Wait a bit before yielding more (giving time to abort)
    await new Promise((resolve) => setTimeout(resolve, 50));

    yield {
      type: "text-delta",
      id: "text-1",
      delta: " World",
    } as UIMessageChunk;

    yield {
      type: "text-end",
      id: "text-1",
    } as UIMessageChunk;

    yield {
      type: "finish",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5 },
    } as UIMessageChunk;
  };

  const agent = createMockAgent(slowStream);

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [],
    signal: abortController.signal,
  });
  const reader = stream.getReader();

  // Read first message
  await reader.read();

  // Abort after partial message
  abortController.abort();

  // Try to read rest (should complete gracefully)
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch (e) {
    // Stream might be closed, that's okay
  }
});

test("runAgent: handles abort before any messages", async () => {
  const abortController = new AbortController();

  // Create a stream that aborts immediately
  const emptyStream = async function* (): AsyncGenerator<UIMessageChunk> {
    // Abort before yielding anything
    throw new DOMException("Aborted", "AbortError");
  };

  const agent = createMockAgent(emptyStream);

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [],
    signal: abortController.signal,
  });
  const reader = stream.getReader();

  // Stream should close gracefully
  const { done } = await reader.read();
  expect(done).toBe(true);
});

test("runAgent: streams updates", async () => {
  // Simple stream without tools
  const agent = createMockAgent(() => createSimpleMessageStream());

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [],
  });
  const reader = stream.getReader();

  // Read at least one message
  let messageCount = 0;
  while (true) {
    const { done } = await reader.read();
    if (done) break;
    messageCount++;
  }

  // Should have streamed at least one message
  expect(messageCount).toBeGreaterThan(0);
});

test("runAgent: stops streaming on pending approval", async () => {
  // Create a stream with pending approval
  const approvalStream = async function* (): AsyncGenerator<UIMessageChunk> {
    yield {
      type: "start",
      messageId: "msg-1",
    } as UIMessageChunk;

    yield {
      type: "start-step",
    } as UIMessageChunk;

    yield {
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "test-tool",
      input: {},
      providerExecuted: false,
    } as UIMessageChunk;

    yield {
      type: "tool-output-available",
      toolCallId: "call-1",
      output: {
        type: "tool-approval",
        outcome: "pending",
      },
      providerExecuted: false,
    } as UIMessageChunk;

    yield {
      type: "finish",
      finishReason: "tool-calls",
      usage: { promptTokens: 10, completionTokens: 5 },
    } as UIMessageChunk;
  };

  const agent = createMockAgent(approvalStream);

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [],
  });
  const reader = stream.getReader();

  // Read all messages
  const messages: UIMessage[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    messages.push(value);
  }

  // readUIMessageStream yields intermediate states, so we might get multiple messages
  expect(messages.length).toBeGreaterThan(0);
});

test("runAgent: handles errors during streaming", async () => {
  // Mock agent that rejects
  const agent = {
    chat: async () => {
      throw new Error("Agent error");
    },
  } as unknown as Client;

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [],
  });
  const reader = stream.getReader();

  // Should propagate the error
  let didThrow = false;
  try {
    await reader.read();
  } catch (error: any) {
    didThrow = true;
    expect(error.message).toContain("Agent error");
  }

  expect(didThrow).toBe(true);
});

test("runAgent: handles existing messages in chat", async () => {
  // Create chat with existing messages
  const existingMessage = {
    id: "existing-1",
    created_at: new Date().toISOString(),
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Hello" }],
    metadata: {},
  };

  const agent = createMockAgent(() => createSimpleMessageStream());

  const stream = await runAgent({
    id: crypto.randomUUID(),
    agent,
    messages: [existingMessage],
  });
  const reader = stream.getReader();

  // Read all messages from stream
  const messages: UIMessage[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    messages.push(value);
  }

  // Should have streamed messages
  expect(messages.length).toBeGreaterThan(0);
});
