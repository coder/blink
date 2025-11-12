import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage, UIMessageChunk } from "ai";
import { ChatManager, type ChatStatus } from "./chat-manager";
import { createDiskStore } from "./disk-store";
import { RWLock } from "./rw-lock";
import type { StoredChat, StoredMessage } from "./types";
import type { Client } from "../agent/client";

// Helper to create a mock agent
function createMockAgent(responseText: string = "Assistant response"): {
  lock: RWLock;
  client: Client;
  chatCalls: any[];
} {
  const chatCalls: any[] = [];
  return {
    lock: new RWLock(),
    chatCalls,
    client: {
      chat: async ({ messages, signal }: any) => {
        chatCalls.push({ messages, signal });

        // Return a ReadableStream of UIMessageChunk objects
        const stream = new ReadableStream<UIMessageChunk>({
          async start(controller) {
            if (signal?.aborted) {
              controller.close();
              return;
            }

            // Start the message
            controller.enqueue({
              type: "start",
              messageId: "msg-1",
            } as UIMessageChunk);

            // Add text content
            controller.enqueue({
              type: "text-start",
              id: "text-1",
            } as UIMessageChunk);

            // Send text
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: responseText,
            } as UIMessageChunk);

            if (!signal?.aborted) {
              controller.enqueue({
                type: "text-end",
                id: "text-1",
              } as UIMessageChunk);

              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: { promptTokens: 10, completionTokens: 5 },
              } as UIMessageChunk);
            }
            controller.close();
          },
        });

        return stream;
      },
    } as any,
  };
}

// Helper to create a slow-streaming agent (yields control between chunks)
function createSlowAgent(chunks: number = 5): { client: Client; lock: RWLock } {
  return {
    lock: new RWLock(),
    client: {
      chat: async ({ signal }: any) => {
        const stream = new ReadableStream<UIMessageChunk>({
          async start(controller) {
            try {
              if (signal?.aborted) {
                controller.close();
                return;
              }

              controller.enqueue({
                type: "start",
                messageId: "msg-1",
              } as UIMessageChunk);

              controller.enqueue({
                type: "text-start",
                id: "text-1",
              } as UIMessageChunk);

              for (let i = 0; i < chunks; i++) {
                if (signal?.aborted) {
                  throw new Error("AbortError");
                }
                controller.enqueue({
                  type: "text-delta",
                  id: "text-1",
                  delta: `chunk${i}`,
                } as UIMessageChunk);
                // Yield control to allow other operations
                await new Promise((resolve) => setImmediate(resolve));
              }

              if (!signal?.aborted) {
                controller.enqueue({
                  type: "text-end",
                  id: "text-1",
                } as UIMessageChunk);

                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: { promptTokens: 10, completionTokens: 5 },
                } as UIMessageChunk);
              }
              controller.close();
            } catch (err: any) {
              if (err.message === "AbortError" || signal?.aborted) {
                controller.close();
              } else {
                controller.error(err);
              }
            }
          },
        });
        return stream;
      },
    } as any,
  };
}

// Helper to create a stored message
function createStoredMessage(
  content: string,
  role: "user" | "assistant" = "user"
): StoredMessage {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    role,
    parts: [{ type: "text", text: content }],
    metadata: undefined,
    mode: "run",
  };
}

// Helper to wait for a state condition
async function waitForState(
  manager: ChatManager,
  predicate: (state: ReturnType<typeof manager.getState>) => boolean,
  timeoutMs = 5000
): Promise<ReturnType<typeof manager.getState>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`waitForState timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = manager.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });

    // Check immediately in case already satisfied
    const currentState = manager.getState();
    if (predicate(currentState)) {
      clearTimeout(timeout);
      unsubscribe();
      resolve(currentState);
    }
  });
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "blink-chatmanager-"));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("initializes with empty state for non-existent chat", async () => {
  const id = crypto.randomUUID();
  const manager = new ChatManager({
    chatId: id,
    chatsDirectory: tempDir,
  });

  const state = manager.getState();
  expect(state.id).toBe(id);
  expect(state.messages).toEqual([]);
  expect(state.status).toBe("idle");
  expect(state.streamingMessage).toBeUndefined();
  expect(state.queuedMessages).toEqual([]);

  manager.dispose();
});

test("loads existing chat from disk", async () => {
  const chatId = crypto.randomUUID();
  const message1 = createStoredMessage("Hello");
  const message2 = createStoredMessage("Hi there", "assistant");

  // Pre-populate the store
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message1, message2],
  });
  await locked.release();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  // Wait for load
  const state = await waitForState(manager, (s) => s.messages.length === 2);

  expect(state.messages).toHaveLength(2);
  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Hello",
  });
  expect(state.messages[1]?.parts[0]).toMatchObject({
    type: "text",
    text: "Hi there",
  });

  manager.dispose();
});

test("upsertMessage adds new message", async () => {
  const chatId = crypto.randomUUID();
  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const message = createStoredMessage("Test message");
  await manager.upsertMessages([message]);

  // Wait for watcher to pick it up
  const state = await waitForState(manager, (s) => s.messages.length === 1);

  expect(state.messages[0]?.id).toBeTruthy();
  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Test message",
  });

  manager.dispose();
});

test("upsertMessage updates existing message with same ID", async () => {
  const chatId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const message1 = {
    ...createStoredMessage("Original content"),
    id: messageId,
  };

  // Pre-populate
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message1],
  });
  await locked.release();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  await waitForState(manager, (s) => s.messages.length === 1);

  // Update the message with the same ID
  const updatedMessage = {
    ...createStoredMessage("Updated content"),
    id: messageId,
  };
  await manager.upsertMessages([updatedMessage]);

  // Verify from disk that the update worked
  await new Promise((resolve) => setImmediate(resolve));
  const fromDisk = await chatStore.get(chatId);
  expect(fromDisk?.messages).toHaveLength(1);
  expect(fromDisk?.messages[0]?.id).toBe(messageId);
  expect(fromDisk?.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Updated content",
  });

  manager.dispose();
});

test("serializeMessage can skip messages by returning undefined", async () => {
  const chatId = crypto.randomUUID();
  const serializeMessage = mock((msg: UIMessage) => {
    const text = msg.parts.find((p) => p.type === "text")?.text;
    if (text?.includes("skip")) return undefined;
    return msg as StoredMessage;
  });

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
    serializeMessage,
  });

  // This should be added
  await manager.upsertMessages([createStoredMessage("Hello")]);
  await waitForState(manager, (s) => s.messages.length === 1);

  // This should be skipped
  await manager.upsertMessages([createStoredMessage("skip this")]);

  // Give a moment for potential update
  await new Promise((resolve) => setImmediate(resolve));

  const state = manager.getState();
  expect(state.messages).toHaveLength(1);
  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Hello",
  });

  manager.dispose();
});

test("serializeMessage modifies messages before persisting", async () => {
  const chatId = crypto.randomUUID();
  const serializeMessage = mock((msg: UIMessage) => {
    const message = msg as StoredMessage;
    return {
      ...message,
      parts: message.parts.map((p) => {
        if (p.type === "text") {
          return { ...p, text: `[modified] ${p.text}` };
        }
        return p;
      }),
    };
  });

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
    serializeMessage,
  });

  await manager.upsertMessages([createStoredMessage("Hello")]);
  const state = await waitForState(manager, (s) => s.messages.length === 1);

  expect(state.messages).toHaveLength(1);
  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "[modified] Hello",
  });

  manager.dispose();
});

test("filters out messages with __blink_internal metadata", async () => {
  const chatId = crypto.randomUUID();
  const normalMessage = createStoredMessage("Normal");
  const internalMessage = {
    ...createStoredMessage("Internal"),
    metadata: { __blink_internal: true, type: "mode", mode: "run" },
  };

  // Pre-populate with both
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [normalMessage, internalMessage as any],
  });
  await locked.release();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const state = await waitForState(manager, (s) => s.messages.length > 0);

  // Should only show the normal message
  expect(state.messages).toHaveLength(1);
  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Normal",
  });

  manager.dispose();
});

test("disk watcher syncs changes from external processes", async () => {
  const chatId = crypto.randomUUID();
  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  // Simulate external write
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [createStoredMessage("External change")],
  });
  await locked.release();

  // Manager should pick up the change
  const state = await waitForState(manager, (s) => s.messages.length === 1);

  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "External change",
  });

  manager.dispose();
});

test("disk watcher handles chat deletion", async () => {
  const chatId = crypto.randomUUID();
  const message = createStoredMessage("Test");

  // Pre-populate
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message],
  });
  await locked.release();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  await waitForState(manager, (s) => s.messages.length === 1);

  // External deletion
  const locked2 = await chatStore.lock(chatId);
  await locked2.delete();
  await locked2.release();

  // Manager should clear state
  const state = await waitForState(manager, (s) => s.messages.length === 0);

  expect(state.messages).toEqual([]);
  expect(state.status).toBe("idle");

  manager.dispose();
});

test("resetChat clears state and deletes from disk", async () => {
  const chatId = crypto.randomUUID();
  const message = createStoredMessage("Test");

  // Pre-populate
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message],
  });
  await locked.release();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  await waitForState(manager, (s) => s.messages.length === 1);

  await manager.resetChat();

  const state = manager.getState();
  expect(state.messages).toEqual([]);
  expect(state.status).toBe("idle");

  // Verify deleted from disk
  const fromDisk = await chatStore.get(chatId);
  expect(fromDisk).toBeUndefined();

  manager.dispose();
});

test("subscribe receives state updates", async () => {
  const chatId = crypto.randomUUID();
  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const updates: any[] = [];
  const unsubscribe = manager.subscribe((state) => {
    updates.push(state);
  });

  await manager.upsertMessages([createStoredMessage("Hello")]);

  await waitForState(manager, (s) => s.messages.length === 1);

  expect(updates.length).toBeGreaterThan(0);
  const lastUpdate = updates[updates.length - 1];
  expect(lastUpdate.messages).toHaveLength(1);

  unsubscribe();
  manager.dispose();
});

test("setAgent updates the agent", async () => {
  const chatId = crypto.randomUUID();
  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createMockAgent();
  manager.setAgent(agent);

  const message = createStoredMessage("Hello");
  await manager.sendMessages([message]);

  // Wait for streaming to complete
  const state = await waitForState(
    manager,
    (s) => s.status === "idle" && s.messages.length === 2
  );

  expect(agent.chatCalls).toHaveLength(1);

  manager.dispose();
});

test("sendMessage queues when already streaming", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createSlowAgent();
  manager.setAgent(agent);

  // Send first message (should start streaming)
  manager.sendMessages([createStoredMessage("Message 1")]);

  // Wait for streaming status
  await waitForState(manager, (s) => s.status === "streaming");

  // Send second message while streaming (should queue)
  await manager.sendMessages([createStoredMessage("Message 2")]);

  // Wait for it to be queued
  await waitForState(manager, (s) => s.queuedMessages.length === 1);

  let state = manager.getState();
  expect(state.queuedMessages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Message 2",
  });

  // Wait for both to complete
  state = await waitForState(
    manager,
    (s) => s.queuedMessages.length === 0 && s.status === "idle"
  );

  expect(state.queuedMessages).toHaveLength(0);

  manager.dispose();
});

test("stopStreaming aborts current stream", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createSlowAgent(20); // Many chunks
  manager.setAgent(agent);

  // Start sending message
  manager.sendMessages([createStoredMessage("Hello")]);

  // Wait for streaming to start
  await waitForState(manager, (s) => s.status === "streaming");

  // Stop it
  manager.stopStreaming();

  // Wait for idle state
  const state = await waitForState(manager, (s) =>
    ["idle", "error"].includes(s.status)
  );

  expect(["idle", "error"]).toContain(state.status);
  expect(state.streamingMessage).toBeUndefined();

  manager.dispose();
});

test("stopStreaming immediately processes queued messages", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createSlowAgent(20); // Many chunks
  manager.setAgent(agent);

  // Start streaming
  manager.sendMessages([createStoredMessage("Message 1")]);
  await waitForState(manager, (s) => s.status === "streaming");

  // Queue a second message
  await manager.sendMessages([createStoredMessage("Message 2")]);
  await waitForState(manager, (s) => s.queuedMessages.length === 1);

  // Stop streaming - should immediately start processing queued message
  const stopTime = Date.now();
  manager.stopStreaming();

  // Wait for the queued message to start processing
  // This should happen very quickly (not 100ms later)
  await waitForState(
    manager,
    (s) => s.queuedMessages.length === 0 && s.status === "streaming"
  );
  const startTime = Date.now();
  const elapsed = startTime - stopTime;

  // Should start within 50ms (much less than the old 100ms timeout)
  expect(elapsed).toBeLessThan(50);

  // Wait for completion
  await waitForState(manager, (s) => s.status === "idle");

  // Should have both messages
  const state = manager.getState();
  expect(state.messages.length).toBeGreaterThanOrEqual(2);

  manager.dispose();
});

test("clearQueue removes all queued messages", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createSlowAgent();
  manager.setAgent(agent);

  // Start streaming
  manager.sendMessages([createStoredMessage("Message 1")]);
  await waitForState(manager, (s) => s.status === "streaming");

  // Queue multiple messages
  await manager.sendMessages([createStoredMessage("Message 2")]);
  await manager.sendMessages([createStoredMessage("Message 3")]);

  // Verify queued
  await waitForState(manager, (s) => s.queuedMessages.length === 2);

  // Clear queue
  manager.clearQueue();

  const state = manager.getState();
  expect(state.queuedMessages).toHaveLength(0);

  manager.dispose();
});

test("resetChat clears queue", async () => {
  const chatId = crypto.randomUUID();

  const agent = createSlowAgent();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });
  manager.setAgent(agent);

  // Start streaming and queue messages
  manager.sendMessages([createStoredMessage("Message 1")]);
  await waitForState(manager, (s) => s.status === "streaming");
  await manager.sendMessages([createStoredMessage("Message 2")]);

  await waitForState(manager, (s) => s.queuedMessages.length === 1);

  // Reset should clear queue and wait for it to be cleared
  await manager.resetChat();

  // Wait for messages to be cleared (the watcher might still see the old state briefly)
  await waitForState(manager, (s) => s.messages.length === 0);

  const state = manager.getState();
  expect(state.queuedMessages).toHaveLength(0);
  expect(state.messages).toHaveLength(0);

  manager.dispose();
});

test("upsertMessage handles invalid chat data by resetting", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  // Manually write invalid data to disk
  const chatStore = createDiskStore<StoredChat>(tempDir, "id");
  const locked = await chatStore.lock(chatId);
  await locked.set({ invalid: "data" } as any);
  await locked.release();

  // Should handle the invalid data and reset
  await manager.upsertMessages([createStoredMessage("New message")]);

  const state = await waitForState(manager, (s) => s.messages.length === 1);

  expect(state.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "New message",
  });

  // Verify the chat was properly initialized
  const fromDisk = await chatStore.get(chatId);
  expect(fromDisk).toBeDefined();
  expect(fromDisk!.id).toBe(chatId);
  expect(fromDisk!.messages).toHaveLength(1);

  manager.dispose();
});

test("status stays idle after stream completes - no flicker back to streaming", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createMockAgent("Response");
  manager.setAgent(agent);

  // Track all status transitions
  const statusTransitions: ChatStatus[] = [];
  manager.subscribe((state) => {
    statusTransitions.push(state.status);
  });

  // Send a message
  await manager.sendMessages([createStoredMessage("Hello")]);

  // Wait for it to complete
  await waitForState(
    manager,
    (s) => s.status === "idle" && s.messages.length === 2
  );

  // Give the watcher time to process any late events
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Find the last transition to idle
  const lastIdleIndex = statusTransitions.lastIndexOf("idle");

  // Check that after reaching idle, we never go back to streaming
  const afterIdle = statusTransitions.slice(lastIdleIndex + 1);

  expect(afterIdle).not.toContain("streaming");

  // Final state should be idle
  const finalState = manager.getState();
  expect(finalState.status).toBe("idle");
  expect(finalState.streamingMessage).toBeUndefined();

  manager.dispose();
});

test("watcher onChange does not cause status to flicker during lock release", async () => {
  const chatId = crypto.randomUUID();

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
  });

  const agent = createSlowAgent(3); // Slow enough to observe the behavior
  manager.setAgent(agent);

  // Track consecutive status transitions
  const statusTransitions: { status: ChatStatus; timestamp: number }[] = [];
  manager.subscribe((state) => {
    statusTransitions.push({ status: state.status, timestamp: Date.now() });
  });

  // Send a message and wait for completion
  await manager.sendMessages([createStoredMessage("Test")]);
  await waitForState(
    manager,
    (s) => s.status === "idle" && s.messages.length === 2
  );

  // Give extra time for any race conditions to manifest
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Find the first transition to idle after streaming started
  const firstStreamingIndex = statusTransitions.findIndex(
    (t) => t.status === "streaming"
  );
  const idleAfterStreamingIndex = statusTransitions.findIndex(
    (t, i) => i > firstStreamingIndex && t.status === "idle"
  );

  // Check if there are any transitions back to streaming after the first idle
  if (idleAfterStreamingIndex !== -1) {
    const transitionsAfterIdle = statusTransitions.slice(
      idleAfterStreamingIndex + 1
    );
    const hasStreamingAfterIdle = transitionsAfterIdle.some(
      (t) => t.status === "streaming"
    );

    if (hasStreamingAfterIdle) {
      throw new Error(
        `Status flickered back to streaming after completing. ` +
          `Transitions: ${JSON.stringify(statusTransitions.map((t) => t.status))}`
      );
    }
  }

  // The final status should be idle
  expect(statusTransitions[statusTransitions.length - 1]?.status).toBe("idle");

  manager.dispose();
});

test("onError callback is called when no agent is available", async () => {
  const chatId = crypto.randomUUID();

  // Track errors via onError callback
  const errors: string[] = [];
  const onError = mock((error: string) => {
    errors.push(error);
  });

  const manager = new ChatManager({
    chatId,
    chatsDirectory: tempDir,
    onError,
  });

  // Don't set an agent, so it should fail when we try to send a message

  // Send a message without an agent
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    role: "user",
    parts: [{ type: "text", text: "Hello" }],
    mode: "run",
    metadata: undefined,
  };

  await manager.sendMessages([message]);

  // Wait a bit for the error to be processed
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Verify onError was called with the "no agent" error message
  expect(onError).toHaveBeenCalled();
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0]).toContain("agent is not available");

  manager.dispose();
});
