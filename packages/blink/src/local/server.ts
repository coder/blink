import { createServerAdapter } from "@whatwg-node/server";
import type { JSONValue, UIMessage } from "ai";
import { createServer as createHTTPServer } from "http";
import * as fs from "node:fs";
import { join } from "node:path";
import type { Client } from "../agent/client";
import type { AgentChat, AgentStore, ID } from "../agent/index.node";
import { api } from "../control";
import { ChatManager } from "./chat-manager";
import { createDiskStore } from "./disk-store";
import { convertMessage, type StoredChat } from "./types";
import { v5 as uuidv5 } from "uuid";
import type { Agent } from "../react/use-agent";

export interface CreateLocalServerOptions {
  readonly dataDirectory: string;
  readonly port?: number;
  readonly getAgent: () => Agent | undefined;
}

export type LocalServer = ReturnType<typeof createLocalServer>;

/**
 * createLocalServer creates a local control server that
 * can be used to control the Blink agent.
 *
 * This server:
 * - Provides the control API for agents to interact with chats
 * - Persists chats to disk using the disk store
 * - Runs agents when messages are sent
 */
export function createLocalServer(options: CreateLocalServerOptions) {
  const chatsDirectory = join(options.dataDirectory, "chats");

  // Simple key-value storage
  let storage: Record<string, string> = {};
  const storagePath = join(options.dataDirectory, "storage.json");
  if (fs.existsSync(storagePath)) {
    storage = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
  }

  // Track chat managers per chat
  const chatManagers = new Map<ID, ChatManager>();
  const getChatManager = (chatId: ID): ChatManager => {
    let manager = chatManagers.get(chatId);
    if (!manager) {
      manager = new ChatManager({
        chatId,
        chatsDirectory,
      });
      chatManagers.set(chatId, manager);
    }
    manager.setAgent(options.getAgent());
    return manager;
  };

  const chat: AgentChat = {
    async upsert(key: JSONValue) {
      const id = uuidv5(JSON.stringify(key), uuidv5.URL) as ID;
      const manager = getChatManager(id);
      const state = manager.getState();
      // Check if chat exists by seeing if it has any data
      const created = state.messages.length === 0 && !state.created_at;
      return {
        id: state.id,
        created,
        createdAt: state.created_at ?? new Date().toISOString(),
        key: key as string,
      };
    },
    async get(id) {
      const manager = getChatManager(id);
      const state = manager.getState();
      return {
        id: state.id,
        createdAt: state.created_at ?? new Date().toISOString(),
      };
    },
    async getMessages(id) {
      const manager = getChatManager(id);
      const state = manager.getState();
      return state.messages;
    },
    async sendMessages(id, messages, opts) {
      const manager = getChatManager(id);
      const converted = messages.map((message) =>
        convertMessage(message as UIMessage, "run")
      );

      if (opts?.behavior === "append") {
        // Just add to disk, don't run agent
        await manager.upsertMessages(converted);
        return;
      }

      if (opts?.behavior === "interrupt") {
        // Add message and run agent
        await manager.sendMessages(converted);
        return;
      }

      await manager.sendMessages(converted);
    },
    async deleteMessages(id, messages) {
      const manager = getChatManager(id);
      await manager.deleteMessages(messages);
    },
    async start(id) {
      const manager = getChatManager(id);
      await manager.start();
    },
    async stop(id) {
      const manager = getChatManager(id);
      await manager.stop();
    },
    async delete(id) {
      const manager = getChatManager(id);
      await manager.resetChat();
    },
  };

  const store: AgentStore = {
    get(key) {
      return Promise.resolve(storage[key]);
    },
    set(key, value) {
      storage[key] = value;
      fs.writeFileSync(storagePath, JSON.stringify(storage), "utf-8");
      return Promise.resolve();
    },
    delete(key) {
      delete storage[key];
      fs.writeFileSync(storagePath, JSON.stringify(storage), "utf-8");
      return Promise.resolve();
    },
    list(prefix, options) {
      const limit = Math.min(options?.limit ?? 100, 1000);
      const cursor = options?.cursor;

      // Get all keys that match the prefix
      const allKeys = Object.keys(storage)
        .filter((key) => key.startsWith(prefix ?? ""))
        .sort();

      // Find the starting index based on cursor
      let startIndex = 0;
      if (cursor) {
        const cursorIndex = allKeys.indexOf(cursor);
        if (cursorIndex !== -1) {
          startIndex = cursorIndex + 1; // Start after the cursor
        }
      }

      // Slice the keys based on limit
      const keysToReturn = allKeys.slice(startIndex, startIndex + limit);

      // Determine the next cursor
      const nextCursor =
        startIndex + limit < allKeys.length
          ? keysToReturn[keysToReturn.length - 1]
          : undefined;

      return Promise.resolve({
        entries: keysToReturn.map((key) => ({
          key,
        })),
        cursor: nextCursor,
      });
    },
  };

  const server = createHTTPServer(
    createServerAdapter((req) => {
      return api.fetch(req, {
        chat,
        store,
      });
    })
  );
  server.listen(options.port ?? 0);

  // For listing chats and direct access, create a separate store instance
  const listStore = createDiskStore<StoredChat>(chatsDirectory, "id");

  return {
    // @ts-expect-error
    url: `http://127.0.0.1:${server.address().port}`,
    chatsDirectory, // Expose for watcher

    getChatManager,

    // Expose list functionality for listing all chats
    listChats: () => listStore.list(),

    dispose: () => {
      // Dispose all chat managers
      for (const manager of chatManagers.values()) {
        manager.dispose();
      }
      chatManagers.clear();
      listStore.dispose();
      server.close();
    },
  };
}
