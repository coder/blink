import * as http from "node:http";
import { createServerAdapter } from "@whatwg-node/server";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import type * as blink from "blink";
import { Client } from "blink/client";
import { api as controlApi } from "blink/control";

/**
 * Creates a mock Blink API server for integration tests.
 * Provides in-memory storage and chat implementations.
 */
export const createMockBlinkApiServer = () => {
  const storage: Record<string, string> = {};
  const sentMessages: Array<{ chatId: blink.ID; messages: unknown[] }> = [];

  const storeImpl: blink.AgentStore = {
    async get(key) {
      const decodedKey = decodeURIComponent(key);
      return storage[decodedKey];
    },
    async set(key, value) {
      const decodedKey = decodeURIComponent(key);
      storage[decodedKey] = value;
    },
    async delete(key) {
      const decodedKey = decodeURIComponent(key);
      delete storage[decodedKey];
    },
    async list(prefix, options) {
      const decodedPrefix = prefix ? decodeURIComponent(prefix) : undefined;
      const limit = Math.min(options?.limit ?? 100, 1000);
      const allKeys = Object.keys(storage)
        .filter((key) => !decodedPrefix || key.startsWith(decodedPrefix))
        .sort();
      let startIndex = 0;
      if (options?.cursor) {
        const cursorIndex = allKeys.indexOf(options.cursor);
        if (cursorIndex !== -1) startIndex = cursorIndex + 1;
      }
      const keysToReturn = allKeys.slice(startIndex, startIndex + limit);
      return {
        entries: keysToReturn.map((key) => ({ key })),
        cursor:
          startIndex + limit < allKeys.length
            ? keysToReturn[keysToReturn.length - 1]
            : undefined,
      };
    },
  };

  const chatImpl: blink.AgentChat = {
    async upsert() {
      return {
        id: "00000000-0000-0000-0000-000000000000" as blink.ID,
        created: true,
        createdAt: new Date().toISOString(),
      };
    },
    async get() {
      return undefined;
    },
    async getMessages() {
      return [];
    },
    async sendMessages(chatId: blink.ID, messages: unknown[]) {
      sentMessages.push({ chatId, messages });
    },
    async deleteMessages() {},
    async start() {},
    async stop() {},
    async delete() {},
  };

  const server = http.createServer(
    createServerAdapter((req) => {
      return controlApi.fetch(req, {
        chat: chatImpl,
        store: storeImpl,
        // biome-ignore lint/suspicious/noExplicitAny: mock
        otlp: undefined as any,
      });
    })
  );

  server.listen(0);

  const getUrl = () => {
    const addr = server.address();
    if (addr && typeof addr !== "string") {
      return `http://127.0.0.1:${addr.port}`;
    }
    return "http://127.0.0.1:0";
  };

  return {
    get url() {
      return getUrl();
    },
    storage,
    sentMessages,
    [Symbol.dispose]: () => {
      server.close();
    },
  };
};

/**
 * Temporarily sets an environment variable and restores it on dispose.
 */
export const withEnvVariable = (key: string, value: string) => {
  const originalValue = process.env[key];
  process.env[key] = value;
  return {
    [Symbol.dispose]: () => {
      if (originalValue) {
        process.env[key] = originalValue;
      } else {
        delete process.env[key];
      }
    },
  };
};

/**
 * Temporarily sets the BLINK_API_URL environment variable.
 */
export const withBlinkApiUrl = (url: string) => {
  return withEnvVariable("BLINK_API_URL", url);
};

export const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Port counter to avoid port collisions between tests
let testPortCounter = 35000;

export interface RunChatTurnResult {
  chunks: UIMessageChunk[];
  assistantMessage: UIMessage;
}

export interface AgentTestHelper extends AsyncDisposable {
  client: Client;
  /** Current message history */
  readonly messages: UIMessage[];
  /**
   * Adds a message to the history.
   */
  addMessage: (role: "user" | "assistant", text: string) => void;
  /**
   * Adds a user message to the history.
   */
  addUserMessage: (text: string) => void;
  /**
   * Runs a chat turn with the current message history.
   * Automatically appends the assistant response to the history.
   * Returns the result including chunks and the assistant message.
   */
  runChatTurn: () => Promise<RunChatTurnResult>;
}

export interface CreateAgentTestHelperOptions {
  /** Initial messages to seed the conversation */
  initialMessages?: UIMessage[];
}

/**
 * Creates a test helper for a blink agent.
 * Starts an HTTP server for the agent and provides methods to interact with it.
 * Manages message history automatically.
 *
 * Usage:
 * ```ts
 * await using helper = createAgentTestHelper(agent, {
 *   initialMessages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Hello" }] }]
 * });
 * const result = await helper.runChatTurn();
 * // Assistant message is automatically added to helper.messages
 * ```
 */
export function createAgentTestHelper(
  agent: blink.Agent<UIMessage>,
  options?: CreateAgentTestHelperOptions
): AgentTestHelper {
  const port = testPortCounter++;
  const server = agent.serve({ port });
  const client = new Client({
    baseUrl: `http://localhost:${port}`,
  });

  const messages: UIMessage[] = options?.initialMessages
    ? [...options.initialMessages]
    : [];

  const addMessage = (role: "user" | "assistant", text: string) => {
    messages.push({
      id: crypto.randomUUID(),
      role,
      parts: [{ type: "text", text }],
    });
  };

  const runChatTurn = async (): Promise<RunChatTurnResult> => {
    const stream = await client.chat({
      id: crypto.randomUUID() as blink.ID,
      messages,
    });

    const chunks: UIMessageChunk[] = [];
    let assistantMessage: UIMessage | null = null;

    const messageStream = readUIMessageStream({
      stream: stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            chunks.push(chunk);
            controller.enqueue(chunk);
          },
        })
      ),
    });

    for await (const message of messageStream) {
      assistantMessage = message;
    }

    if (!assistantMessage) {
      throw new Error("No assistant message received from stream");
    }

    // Automatically append assistant message to history
    messages.push(assistantMessage);

    return { chunks, assistantMessage };
  };

  return {
    client,
    get messages() {
      return messages;
    },
    addMessage,
    addUserMessage: (text: string) => addMessage("user", text),
    runChatTurn,
    [Symbol.asyncDispose]: async () => {
      const closed = server[Symbol.asyncDispose]();
      server.closeAllConnections();
      await closed;
    },
  };
}
