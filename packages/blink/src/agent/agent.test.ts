import { expect, test, describe, mock, beforeEach, afterEach } from "bun:test";
import type { UIMessage } from "ai";
import * as http from "http";
import { createServerAdapter } from "@whatwg-node/server";
import { api as controlApi } from "../control";
import { Agent, model, waitUntil, api } from "./agent";
import type {
  AgentChat,
  AgentStore,
  ID,
  NewMessage,
  SendOptions,
  UpsertedChat,
  Chat,
} from "./types";

// Create a mock API server similar to createLocalServer
function createMockApiServer() {
  // Track all calls to the API for assertions
  const calls = {
    chatUpsert: [] as any[],
    chatGet: [] as any[],
    chatGetMessages: [] as any[],
    chatSendMessages: [] as any[],
    chatDeleteMessages: [] as any[],
    chatStart: [] as any[],
    chatStop: [] as any[],
    chatDelete: [] as any[],
    storeGet: [] as any[],
    storeSet: [] as any[],
    storeDelete: [] as any[],
    storeList: [] as any[],
  };

  // Mock storage
  const storage: Record<string, string> = {};

  // Mock chats
  const chats = new Map<ID, { messages: UIMessage[]; createdAt: string }>();

  const chatImpl: AgentChat = {
    async upsert(key) {
      calls.chatUpsert.push({ key });
      const id = "00000000-0000-0000-0000-000000000000" as ID;
      const existing = chats.get(id);
      const created = !existing;
      if (!existing) {
        chats.set(id, { messages: [], createdAt: new Date().toISOString() });
      }
      return {
        id,
        created,
        createdAt: chats.get(id)!.createdAt,
      } as UpsertedChat;
    },
    async get(id) {
      calls.chatGet.push({ id });
      const chat = chats.get(id);
      if (!chat) return undefined;
      return {
        id,
        createdAt: chat.createdAt,
      } as Chat;
    },
    async getMessages(id) {
      calls.chatGetMessages.push({ id });
      const chat = chats.get(id);
      return chat?.messages ?? [];
    },
    async sendMessages(id, messages, options) {
      calls.chatSendMessages.push({ id, messages, options });
      const chat = chats.get(id);
      if (chat) {
        chat.messages.push(...(messages as UIMessage[]));
      }
    },
    async deleteMessages(id, messages) {
      calls.chatDeleteMessages.push({ id, messages });
      const chat = chats.get(id);
      if (chat && messages) {
        chat.messages = chat.messages.filter((m) => !messages.includes(m.id));
      }
    },
    async start(id) {
      calls.chatStart.push({ id });
    },
    async stop(id) {
      calls.chatStop.push({ id });
    },
    async delete(id) {
      calls.chatDelete.push({ id });
      chats.delete(id);
    },
  };

  const storeImpl: AgentStore = {
    async get(key) {
      // Decode the key since the Agent class encodes it
      const decodedKey = decodeURIComponent(key);
      calls.storeGet.push({ key: decodedKey });
      return storage[decodedKey];
    },
    async set(key, value) {
      // Decode the key since the Agent class encodes it
      const decodedKey = decodeURIComponent(key);
      calls.storeSet.push({ key: decodedKey, value });
      storage[decodedKey] = value;
    },
    async delete(key) {
      // Decode the key since the Agent class encodes it
      const decodedKey = decodeURIComponent(key);
      calls.storeDelete.push({ key: decodedKey });
      delete storage[decodedKey];
    },
    async list(prefix, options) {
      // Decode the prefix since the Agent class encodes it
      const decodedPrefix = prefix ? decodeURIComponent(prefix) : undefined;
      calls.storeList.push({ prefix: decodedPrefix, options });
      const limit = Math.min(options?.limit ?? 100, 1000);
      const allKeys = Object.keys(storage)
        .filter((key) => !decodedPrefix || key.startsWith(decodedPrefix))
        .sort();

      let startIndex = 0;
      if (options?.cursor) {
        const cursorIndex = allKeys.indexOf(options.cursor);
        if (cursorIndex !== -1) {
          startIndex = cursorIndex + 1;
        }
      }

      const keysToReturn = allKeys.slice(startIndex, startIndex + limit);
      const nextCursor =
        startIndex + limit < allKeys.length
          ? keysToReturn[keysToReturn.length - 1]
          : undefined;

      return {
        entries: keysToReturn.map((key) => ({ key })),
        cursor: nextCursor,
      };
    },
  };

  const server = http.createServer(
    createServerAdapter((req) => {
      return controlApi.fetch(req, {
        chat: chatImpl,
        store: storeImpl,
        otlp: undefined as any,
      });
    })
  );

  server.listen(0); // Random port

  return {
    get url() {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        return `http://127.0.0.1:${addr.port}`;
      }
      return "http://127.0.0.1:0";
    },
    calls,
    storage,
    chats,
    async dispose() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

describe("API Shim - Agent with Mock API Server", () => {
  let mockServer: ReturnType<typeof createMockApiServer>;
  let originalApiUrl: string | undefined;
  let agentServer: http.Server | undefined;

  beforeEach(async () => {
    mockServer = createMockApiServer();
    // Wait for server to start
    await new Promise<void>((resolve) => {
      const checkListening = () => {
        const url = mockServer.url;
        if (url && url.includes("127.0.0.1")) {
          resolve();
        } else {
          setTimeout(checkListening, 10);
        }
      };
      checkListening();
    });
    originalApiUrl = process.env.BLINK_API_URL;
    process.env.BLINK_API_URL = mockServer.url;
  });

  afterEach(async () => {
    if (agentServer) {
      await new Promise<void>((resolve) => {
        agentServer!.close(() => resolve());
      });
      agentServer = undefined;
    }
    if (mockServer) {
      await mockServer.dispose();
    }
    if (originalApiUrl) {
      process.env.BLINK_API_URL = originalApiUrl;
    } else {
      delete process.env.BLINK_API_URL;
    }
  });

  test("Agent.chat.upsert() calls API", async () => {
    const instance = new Agent();

    const result = await instance.chat.upsert({ userId: "123" });

    expect(mockServer.calls.chatUpsert).toHaveLength(1);
    // The Agent class JSON.stringify's the key before sending it
    expect(mockServer.calls.chatUpsert[0].key).toBe('{"userId":"123"}');
    expect(result.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(result.created).toBe(true);
    expect(result.createdAt).toBeDefined();
  });

  test("Agent.chat.get() calls API", async () => {
    const instance = new Agent();
    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    // Create a chat first
    mockServer.chats.set(chatId, {
      messages: [],
      createdAt: new Date().toISOString(),
    });

    const result = await instance.chat.get(chatId);

    expect(mockServer.calls.chatGet).toHaveLength(1);
    expect(mockServer.calls.chatGet[0].id).toBe(chatId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(chatId);
  });

  test("Agent.chat.getMessages() calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    mockServer.chats.set(chatId, {
      messages: [
        {
          id: "msg1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        } as UIMessage,
      ],
      createdAt: new Date().toISOString(),
    });

    const messages = await instance.chat.getMessages(chatId);

    expect(mockServer.calls.chatGetMessages).toHaveLength(1);
    expect(mockServer.calls.chatGetMessages[0]?.id).toBe(chatId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("msg1");
  });

  test("Agent.chat.sendMessages() calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    mockServer.chats.set(chatId, {
      messages: [],
      createdAt: new Date().toISOString(),
    });

    const newMessages: NewMessage<UIMessage>[] = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
    ];

    await instance.chat.sendMessages(chatId, newMessages);

    expect(mockServer.calls.chatSendMessages).toHaveLength(1);
    expect(mockServer.calls.chatSendMessages[0].id).toBe(chatId);
    expect(mockServer.calls.chatSendMessages[0].messages).toEqual(newMessages);
  });

  test("Agent.chat.sendMessages() with options calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    mockServer.chats.set(chatId, {
      messages: [],
      createdAt: new Date().toISOString(),
    });

    const newMessages: NewMessage<UIMessage>[] = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
    ];
    const options: SendOptions = { behavior: "interrupt" };

    await instance.chat.sendMessages(chatId, newMessages, options);

    expect(mockServer.calls.chatSendMessages).toHaveLength(1);
    expect(mockServer.calls.chatSendMessages[0].options).toEqual(options);
  });

  test("Agent.chat.deleteMessages() calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    await instance.chat.deleteMessages(chatId, ["msg1", "msg2"]);

    expect(mockServer.calls.chatDeleteMessages).toHaveLength(1);
    expect(mockServer.calls.chatDeleteMessages[0].id).toBe(chatId);
    expect(mockServer.calls.chatDeleteMessages[0].messages).toEqual([
      "msg1",
      "msg2",
    ]);
  });

  test("Agent.chat.start() calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    await instance.chat.start(chatId);

    expect(mockServer.calls.chatStart).toHaveLength(1);
    expect(mockServer.calls.chatStart[0].id).toBe(chatId);
  });

  test("Agent.chat.stop() calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    await instance.chat.stop(chatId);

    expect(mockServer.calls.chatStop).toHaveLength(1);
    expect(mockServer.calls.chatStop[0].id).toBe(chatId);
  });

  test("Agent.chat.delete() calls API", async () => {
    const instance = new Agent();

    const chatId = "00000000-0000-0000-0000-000000000000" as ID;

    await instance.chat.delete(chatId);

    expect(mockServer.calls.chatDelete).toHaveLength(1);
    expect(mockServer.calls.chatDelete[0].id).toBe(chatId);
  });

  test("Agent.store.get() calls API", async () => {
    const instance = new Agent();

    mockServer.storage["testKey"] = "testValue";

    const value = await instance.store.get("testKey");

    expect(mockServer.calls.storeGet).toHaveLength(1);
    expect(mockServer.calls.storeGet[0].key).toBe("testKey");
    expect(value).toBe("testValue");
  });

  test("Agent.store.set() calls API", async () => {
    const instance = new Agent();

    await instance.store.set("testKey", "testValue");

    expect(mockServer.calls.storeSet).toHaveLength(1);
    expect(mockServer.calls.storeSet[0].key).toBe("testKey");
    expect(mockServer.calls.storeSet[0].value).toBe("testValue");
    expect(mockServer.storage["testKey"]).toBe("testValue");
  });

  test("Agent.store.delete() calls API", async () => {
    const instance = new Agent();

    mockServer.storage["testKey"] = "testValue";

    await instance.store.delete("testKey");

    expect(mockServer.calls.storeDelete).toHaveLength(1);
    expect(mockServer.calls.storeDelete[0].key).toBe("testKey");
    expect(mockServer.storage["testKey"]).toBeUndefined();
  });

  test("Agent.store.list() calls API", async () => {
    const instance = new Agent();

    mockServer.storage["prefix:key1"] = "value1";
    mockServer.storage["prefix:key2"] = "value2";
    mockServer.storage["other:key3"] = "value3";

    const result = await instance.store.list("prefix:");

    expect(mockServer.calls.storeList).toHaveLength(1);
    expect(mockServer.calls.storeList[0]?.prefix).toBe("prefix:");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.key).toBe("prefix:key1");
    expect(result.entries[1]?.key).toBe("prefix:key2");
  });

  test("Agent.store.list() with limit and cursor", async () => {
    const instance = new Agent();

    for (let i = 0; i < 10; i++) {
      mockServer.storage[`key${i}`] = `value${i}`;
    }

    const result = await instance.store.list(undefined, { limit: 5 });

    expect(result.entries).toHaveLength(5);
    expect(result.cursor).toBeDefined();

    // Get next page
    const result2 = await instance.store.list(undefined, {
      limit: 5,
      cursor: result.cursor,
    });
    expect(result2.entries).toHaveLength(5);
  });
});

describe("API Shim - Basic Exports", () => {
  test("exports Agent class", () => {
    expect(Agent).toBeDefined();
    expect(typeof Agent).toBe("function");
  });

  test("exports model function", () => {
    expect(model).toBeDefined();
    expect(typeof model).toBe("function");
  });

  test("exports waitUntil function", () => {
    expect(waitUntil).toBeDefined();
    expect(typeof waitUntil).toBe("function");
  });

  test("exports api Hono instance", () => {
    expect(api).toBeDefined();
    expect(typeof api.fetch).toBe("function");
  });

  test("namespace import provides all exports", async () => {
    const blink = await import("./agent");

    expect(blink.Agent).toBeDefined();
    expect(blink.agent).toBeDefined();
    expect(blink.model).toBeDefined();
    expect(blink.waitUntil).toBeDefined();
    expect(blink.api).toBeDefined();
  });
});

describe("API Shim - Agent Functionality", () => {
  test("Agent.on() registers event handlers and returns agent for chaining", async () => {
    const instance = new Agent();

    const chatHandler = mock(() => {});
    const uiHandler = mock(() => {});
    const requestHandler = mock(() => {});
    const errorHandler = mock(() => {});

    const result = instance
      .on("chat", chatHandler)
      .on("ui", uiHandler)
      .on("request", requestHandler)
      .on("error", errorHandler);

    expect(result).toBe(instance);
  });

  test("Agent.fetch() handles health check", async () => {
    const instance = new Agent();

    const req = new Request("http://localhost/_agent/health");
    const res = await instance.fetch(req);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("Agent.fetch() returns capabilities", async () => {
    const instance = new Agent();

    instance.on("chat", () => {});
    instance.on("ui", () => {});

    const req = new Request("http://localhost/_agent/capabilities");
    const res = await instance.fetch(req);

    expect(res.status).toBe(200);
    const capabilities = await res.json();
    expect(capabilities).toEqual({
      chat: true,
      ui: true,
      request: false,
      error: false,
    });
  });

  test("Agent.fetch() handles chat requests", async () => {
    const instance = new Agent();

    const chatHandler = mock(() => {
      return new Response("test response");
    });

    instance.on("chat", chatHandler);

    const req = new Request("http://localhost/_agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000000",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      }),
    });

    const res = await instance.fetch(req);

    expect(res.status).toBe(200);
    expect(chatHandler).toHaveBeenCalledTimes(1);
    expect(chatHandler.mock.calls.length).toBeGreaterThan(0);

    // TypeScript doesn't know that mock.calls is non-empty after toHaveBeenCalledTimes
    const callArgs = (chatHandler.mock.calls as any)[0][0];
    expect(callArgs.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.abortSignal).toBeDefined();
  });

  test("Agent.fetch() handles request events", async () => {
    const instance = new Agent();

    const requestHandler = mock((req: Request) => {
      return new Response("custom response");
    });

    instance.on("request", requestHandler);

    const req = new Request("http://localhost/custom");
    const res = await instance.fetch(req);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("custom response");
    expect(requestHandler).toHaveBeenCalledTimes(1);
  });

  test("model() requires authentication", () => {
    const oldToken = process.env.BLINK_TOKEN;
    const oldInvocationToken = process.env.BLINK_INVOCATION_AUTH_TOKEN;
    delete process.env.BLINK_TOKEN;
    delete process.env.BLINK_INVOCATION_AUTH_TOKEN;

    expect(() => model("anthropic/claude-sonnet-4")).toThrow(
      "You must be authenticated with Blink to use the model gateway"
    );

    if (oldToken) process.env.BLINK_TOKEN = oldToken;
    if (oldInvocationToken)
      process.env.BLINK_INVOCATION_AUTH_TOKEN = oldInvocationToken;
  });

  test("model() creates provider when authenticated", () => {
    process.env.BLINK_TOKEN = "test-token";

    const provider = model("anthropic/claude-sonnet-4");
    expect(provider).toBeDefined();
    expect(provider.modelId).toBe("anthropic/claude-sonnet-4");

    delete process.env.BLINK_TOKEN;
  });

  test("waitUntil() executes promise", async () => {
    let executed = false;
    let resolvePromise: () => void;
    const promiseCompleted = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const promise = async () => {
      executed = true;
      resolvePromise();
    };

    waitUntil(promise);

    await promiseCompleted;
    expect(executed).toBe(true);
  });

  test("waitUntil() handles promise rejection", async () => {
    const consoleWarn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = consoleWarn;

    const promise = async () => {
      throw new Error("test error");
    };

    waitUntil(promise);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(consoleWarn).toHaveBeenCalled();

    console.warn = originalWarn;
  });
});
