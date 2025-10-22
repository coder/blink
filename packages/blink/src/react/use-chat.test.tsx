import type { UIMessage } from "ai";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { render } from "ink";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { useEffect } from "react";
import { createDiskStore } from "../local/disk-store";
import type { StoredChat, StoredMessage } from "../local/types";
import useChat, { type UseChat, type UseChatOptions } from "./use-chat";

// Test harness component
type HarnessProps = {
  options: UseChatOptions;
  onUpdate: (result: UseChat) => void;
};

const Harness: React.FC<HarnessProps> = ({ options, onUpdate }) => {
  const result = useChat(options);
  useEffect(() => {
    onUpdate(result);
  }, [
    result.status,
    result.messages.length,
    result.streamingMessage,
    result.queuedMessages.length,
  ]);
  return null;
};

// Observer for hook state
function createObserver() {
  let latest: UseChat | undefined;
  let resolvers: Array<(r: UseChat) => void> = [];
  const onUpdate = (r: UseChat) => {
    latest = r;
    const toResolve = resolvers;
    resolvers = [];
    for (const resolve of toResolve) resolve(r);
  };
  const next = () =>
    new Promise<UseChat>((resolve) => {
      resolvers.push(resolve);
    });
  const waitFor = async (
    predicate: (r: UseChat) => boolean,
    timeoutMs = 2000
  ) => {
    const start = Date.now();
    if (latest && predicate(latest)) return latest;
    while (Date.now() - start < timeoutMs) {
      const r = await next();
      if (predicate(r)) return r;
    }
    throw new Error("waitFor timed out");
  };
  const getLatest = () => latest as UseChat;
  return { onUpdate, waitFor, getLatest };
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

let tempDir: string;
let chatStore: ReturnType<typeof createDiskStore<StoredChat>>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "blink-usechat-"));
  chatStore = createDiskStore<StoredChat>(tempDir, "id");
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("initializes with empty state for non-existent chat", async () => {
  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId: "00000000-0000-0000-0000-000000000000",
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  const r = await waitFor(() => true);
  expect(r.id).toBe("00000000-0000-0000-0000-000000000000");
  expect(r.messages).toEqual([]);
  expect(r.status).toBe("idle");
  expect(r.streamingMessage).toBeUndefined();

  app.unmount();
});

test("loads existing chat from disk", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const message1 = createStoredMessage("Hello");
  const message2 = createStoredMessage("Hi there", "assistant");

  // Pre-populate the store
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message1, message2],
  });
  await locked.release();

  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  const r = await waitFor((s) => s.messages.length === 2);
  expect(r.messages).toHaveLength(2);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Hello",
  });
  expect(r.messages[1]?.parts[0]).toMatchObject({
    type: "text",
    text: "Hi there",
  });

  app.unmount();
});

test("upsertMessage adds new message", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor(() => true);
  const message = createStoredMessage("Test message");
  await getLatest().upsertMessage(message);

  const r = await waitFor((s) => s.messages.length === 1);
  // convertMessage generates a new ID, so we can't check exact ID match
  expect(r.messages[0]?.id).toBeTruthy();
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Test message",
  });

  app.unmount();
});

test("upsertMessage adds messages sequentially", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const message1 = createStoredMessage("First message");

  // Pre-populate
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message1],
  });
  await locked.release();

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => s.messages.length === 1);

  // Add another message
  const message2 = createStoredMessage("Second message");
  await getLatest().upsertMessage(message2);

  const r = await waitFor((s) => s.messages.length === 2);
  expect(r.messages).toHaveLength(2);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "First message",
  });
  expect(r.messages[1]?.parts[0]).toMatchObject({
    type: "text",
    text: "Second message",
  });

  app.unmount();
});

test("resetChat clears state and deletes from disk", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const message = createStoredMessage("Test");

  // Pre-populate
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message],
  });
  await locked.release();

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => s.messages.length === 1);
  await getLatest().resetChat();

  const r = await waitFor((s) => s.messages.length === 0);
  expect(r.messages).toEqual([]);
  expect(r.status).toBe("idle");

  // Verify deleted from disk
  const fromDisk = await chatStore.get(chatId);
  expect(fromDisk).toBeUndefined();

  app.unmount();
});

test("serializeMessage can skip messages by returning undefined", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const serializeMessage = mock((msg: UIMessage) => {
    // Skip messages with "skip" in content
    const text = msg.parts.find((p) => p.type === "text")?.text;
    if (text?.includes("skip")) return undefined;
    return msg as StoredMessage;
  });

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
        serializeMessage,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor(() => true);

  // This should be added
  await getLatest().upsertMessage(createStoredMessage("Hello"));
  await waitFor((s) => s.messages.length === 1);

  // This should be skipped
  await getLatest().upsertMessage(createStoredMessage("skip this"));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const r = getLatest();
  expect(r.messages).toHaveLength(1);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Hello",
  });

  app.unmount();
});

test("serializeMessage modifies messages before persisting", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const serializeMessage = mock((msg: UIMessage) => {
    // Add a prefix to all messages
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

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
        serializeMessage,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor(() => true);

  await getLatest().upsertMessage(createStoredMessage("Hello"));
  const r = await waitFor((s) => s.messages.length === 1);

  expect(r.messages).toHaveLength(1);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "[modified] Hello",
  });
  expect(serializeMessage).toHaveBeenCalled();

  app.unmount();
});

test("filters out messages with __blink_internal metadata", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const normalMessage = createStoredMessage("Normal");
  const internalMessage = {
    ...createStoredMessage("Internal"),
    metadata: { __blink_internal: true, type: "mode", mode: "run" },
  };

  // Pre-populate with both
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [normalMessage, internalMessage as any],
  });
  await locked.release();

  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  // Wait for the disk watcher to pick up the changes
  const r = await waitFor((s) => s.messages.length > 0, 3000);
  // Should only show the normal message
  expect(r.messages).toHaveLength(1);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Normal",
  });

  app.unmount();
});

test("disk watcher syncs changes from external processes", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor(() => true);

  // Simulate external write
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [createStoredMessage("External change")],
  });
  await locked.release();

  // Hook should pick up the change
  const r = await waitFor((s) => s.messages.length === 1, 3000);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "External change",
  });

  app.unmount();
});

test("disk watcher handles chat deletion", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const message = createStoredMessage("Test");

  // Pre-populate
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message],
  });
  await locked.release();

  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => s.messages.length === 1);

  // External deletion
  const locked2 = await chatStore.lock(chatId);
  await locked2.delete();
  await locked2.release();

  // Hook should clear state
  const r = await waitFor((s) => s.messages.length === 0, 3000);
  expect(r.messages).toEqual([]);
  expect(r.status).toBe("idle");

  app.unmount();
});

test("disk watcher handles invalid chat data", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";

  // Pre-populate with valid data
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [createStoredMessage("Valid")],
  });
  await locked.release();

  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => s.messages.length === 1);

  // Write invalid data (missing messages array)
  const locked2 = await chatStore.lock(chatId);
  await locked2.set({ id: chatId } as any);
  await locked2.release();

  // Hook should clear state
  const r = await waitFor((s) => s.messages.length === 0, 3000);
  expect(r.messages).toEqual([]);

  app.unmount();
});

test("stopStreaming aborts ongoing stream", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";

  // Create a mock agent that streams slowly with proper SSE format
  const agent = {
    chat: async ({ signal }: any) => {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Send init event
            controller.enqueue(`event: init
data: {}

`);

            // Send multiple chunks with delays to simulate slow streaming
            for (let i = 0; i < 10; i++) {
              if (signal?.aborted) {
                throw new Error("AbortError");
              }
              controller.enqueue(`event: stream
data: {"type":"text-delta","textDelta":"chunk${i}"}

`);
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            if (!signal?.aborted) {
              controller.enqueue(`event: finish
data: {"type":"finish","finishReason":"stop"}

`);
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
      return new Response(stream);
    },
  } as any;

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor(() => true);

  // Start sending message (but don't await)
  const sendPromise = getLatest().sendMessage(createStoredMessage("Hello"));

  // Wait for streaming to actually start
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Stop it
  getLatest().stopStreaming();

  // Wait for the promise to resolve
  await sendPromise;

  const r = getLatest();
  // When aborted, status should be idle (or possibly error if the abort wasn't clean)
  expect(["idle", "error"]).toContain(r.status);
  expect(r.streamingMessage).toBeUndefined();

  app.unmount();
});

test("upsertMessage handles invalid chat data by resetting", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor(() => true);

  // Manually write invalid data to disk
  const locked = await chatStore.lock(chatId);
  await locked.set({ invalid: "data" } as any);
  await locked.release();

  // Wait a bit for the disk watcher to potentially pick it up
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Should handle the invalid data and reset
  await getLatest().upsertMessage(createStoredMessage("New message"));

  const r = await waitFor((s) => s.messages.length === 1, 3000);
  expect(r.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "New message",
  });

  // Verify the chat was properly initialized
  const fromDisk = await chatStore.get(chatId);
  expect(fromDisk).toBeDefined();
  expect(fromDisk!.id).toBe(chatId);
  expect(fromDisk!.messages).toHaveLength(1);

  app.unmount();
});

test("disk watcher detects external lock and updates", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const message1 = createStoredMessage("First");

  // Pre-populate
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message1],
  });
  await locked.release();

  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  // Wait for initial load
  await waitFor((s) => s.messages.length === 1);

  // Simulate external process adding a message
  const locked2 = await chatStore.lock(chatId);
  const current = await locked2.get();
  await locked2.set({
    ...current!,
    messages: [...current!.messages, createStoredMessage("External add")],
    updated_at: new Date().toISOString(),
  });
  await locked2.release();

  // Watcher should pick up the change
  const r = await waitFor((s) => s.messages.length === 2, 2000);
  expect(r.messages).toHaveLength(2);
  expect(r.messages[1]?.parts[0]).toMatchObject({
    type: "text",
    text: "External add",
  });

  app.unmount();
});

test("disk watcher avoids re-renders when messages haven't changed", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const message = createStoredMessage("Test");

  // Pre-populate
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message],
  });
  await locked.release();

  let updateCount = 0;
  const { onUpdate, waitFor } = createObserver();
  const countingOnUpdate = (r: UseChat) => {
    updateCount++;
    onUpdate(r);
  };

  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={countingOnUpdate}
    />
  );

  await waitFor((s) => s.messages.length === 1);
  const countAfterLoad = updateCount;

  // Write same messages again with updated timestamp
  const locked2 = await chatStore.lock(chatId);
  const current = await locked2.get();
  await locked2.set({
    ...current!,
    updated_at: new Date().toISOString(),
  });
  await locked2.release();

  // Wait a bit to see if unnecessary updates occur
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Update count should not have increased significantly (maybe 1-2 for status updates)
  expect(updateCount).toBeLessThan(countAfterLoad + 5);

  app.unmount();
});

test("upsertMessage actually updates messages with same ID", async () => {
  const chatId = "00000000-0000-0000-0000-000000000000";
  const messageId = crypto.randomUUID();
  const message1 = {
    ...createStoredMessage("Original content"),
    id: messageId,
  };

  // Pre-populate
  const locked = await chatStore.lock(chatId);
  await locked.set({
    id: chatId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [message1],
  });
  await locked.release();

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      options={{
        chatId,
        agent: undefined,
        chatsDirectory: tempDir,
      }}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => s.messages.length === 1);

  // Update the message with the same ID
  const updatedMessage = {
    ...createStoredMessage("Updated content"),
    id: messageId,
  };
  await getLatest().upsertMessage(updatedMessage);

  // Verify from disk that the update worked
  await new Promise((resolve) => setTimeout(resolve, 1500)); // Wait for watcher to pick up
  const fromDisk = await chatStore.get(chatId);
  expect(fromDisk?.messages).toHaveLength(1);
  expect(fromDisk?.messages[0]?.id).toBe(messageId);
  expect(fromDisk?.messages[0]?.parts[0]).toMatchObject({
    type: "text",
    text: "Updated content",
  });

  app.unmount();
});
