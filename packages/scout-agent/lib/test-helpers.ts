import * as http from "node:http";
import { createServerAdapter } from "@whatwg-node/server";
import type * as blink from "blink";
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
