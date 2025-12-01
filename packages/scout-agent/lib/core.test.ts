import { describe, expect, mock, test } from "bun:test";
import * as http from "node:http";
import { Server as ComputeServer } from "@blink-sdk/compute-protocol/server";
import { createServerAdapter } from "@whatwg-node/server";
import {
  readUIMessageStream,
  simulateReadableStream,
  streamText,
  type UIMessage,
} from "ai";
import { MockLanguageModelV2 } from "ai/test";
import * as blink from "blink";
import { Client } from "blink/client";
import { api as controlApi } from "blink/control";
import { WebSocketServer } from "ws";
import type { DaytonaClient, DaytonaSandbox } from "./compute/daytona/index";
import { type Message, Scout } from "./index";

// Add async iterator support to ReadableStream for testing
declare global {
  // biome-ignore lint/suspicious/noExplicitAny: this is a test
  interface ReadableStream<R = any> {
    [Symbol.asyncIterator](): AsyncIterableIterator<R>;
  }
}

type DoStreamOptions = Parameters<MockLanguageModelV2["doStream"]>[0];

const newMockModel = ({
  textResponse,
  onDoStream,
}: {
  textResponse: string;
  onDoStream?: (args: DoStreamOptions) => Promise<void> | void;
}) => {
  return new MockLanguageModelV2({
    doStream: async (options) => {
      await onDoStream?.(options);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: textResponse },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: "stop",
              logprobs: undefined,
              usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
            },
          ],
        }),
      };
    },
  });
};

const newAgent = (options: {
  model: MockLanguageModelV2;
  core?: Omit<ConstructorParameters<typeof Scout>[0], "agent">;
}) => {
  const agent = new blink.Agent<Message>();
  const core = new Scout({ agent, ...options.core });
  agent.on("request", async () => {
    return new Response("Hello, world!", { status: 200 });
  });
  agent.on("chat", async ({ messages }) => {
    const params = core.buildStreamTextParams({
      model: options.model,
      messages,
      chatID: "b485db32-3d53-45fb-b980-6f4672fc66a6",
    });
    return streamText(params);
  });
  return agent;
};

let portCounter = 34000;

const setup = async (options: Parameters<typeof newAgent>[0]) => {
  const agent = newAgent(options);
  // For a reason I don't understand, the cleanup of the server is not working correctly.
  // If 2 tests reuse the same port, a test will see the previous test's server still running.
  // This is a workaround to use a different port for each test.
  // TODO: Figure out why the cleanup is not working correctly and fix it.
  const port = portCounter++;
  const server = agent.serve({
    port,
  });
  const client = new Client({
    baseUrl: `http://localhost:${port}`,
  });
  return {
    agent,
    server,
    client,
    [Symbol.asyncDispose]: async () => {
      const closed = server[Symbol.asyncDispose]();
      server.closeAllConnections();
      await closed;
    },
  };
};

const sendMessages = async (client: Client, messages: UIMessage[]) => {
  const transform = new TransformStream<UIMessage, UIMessage>();
  const writer = transform.writable.getWriter();

  const stream = await client.chat({
    id: crypto.randomUUID(),
    messages,
  });
  const messageStream = readUIMessageStream({
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [],
      metadata: {},
    },
    stream,
    onError: (error) => {
      writer.abort(error);
    },
  });
  (async () => {
    for await (const message of messageStream) {
      await writer.write(message);
    }
    writer.close();
  })();
  return transform.readable;
};

const sendUserMessage = async (client: Client, message: string) => {
  return sendMessages(client, [
    {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: message,
        },
      ],
    },
  ]);
};

const newPromise = <T>(timeoutMs: number = 5000) => {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;
  // > The executor is called synchronously (as soon as the Promise is constructed)
  // > with the resolveFunc and rejectFunc functions as arguments.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/Promise
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  const timeout = setTimeout(() => {
    reject(new Error("Timeout"));
  }, timeoutMs);
  return {
    promise,
    resolve: (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    },
    reject: (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    },
  };
};

test("core class name", () => {
  // biome-ignore lint/complexity/useLiteralKeys: accessing a private field
  expect(Scout["CLASS_NAME"]).toBe(Scout.name);
});

describe("config", async () => {
  const findWarningLog = (logs: unknown[]) => {
    return logs.find(
      (l): l is string => typeof l === "string" && l.includes("not configured")
    );
  };
  const cases = {
    "warning messages": [
      {
        name: "empty config",
        config: {},
        assertion: ({ logs }) => {
          const log = findWarningLog(logs);
          expect(log).toBeDefined();
          expect(log).toInclude(
            "GitHub is not configured. The `appID`, `privateKey`, and `webhookSecret` config fields are undefined."
          );
          expect(log).toInclude(
            "Slack is not configured. The `botToken` and `signingSecret` config fields are undefined."
          );
          expect(log).toInclude(
            "Web search is not configured. The `exaApiKey` config field is undefined."
          );
          expect(log).toInclude(
            "Did you provide all required environment variables?"
          );
          expect(log).toInclude(
            `Alternatively, you can suppress this message by setting \`suppressConfigWarnings\` to \`true\` on \`${Scout.name}\`.`
          );
        },
      },
      {
        name: "partial github config",
        config: {
          github: {
            appID: "set",
            privateKey: undefined,
            webhookSecret: undefined,
          },
        },
        assertion: ({ logs }) => {
          const log = findWarningLog(logs);
          expect(log).toBeDefined();
          expect(log).toInclude(
            "GitHub is not configured. The `privateKey` and `webhookSecret` config fields are undefined."
          );
        },
      },
      {
        name: "full slack config",
        config: { slack: { botToken: "test", signingSecret: "set" } },
        assertion: ({ logs }) => {
          const log = findWarningLog(logs);
          expect(log).toBeDefined();
          expect(log).not.toInclude("Slack is not configured");
        },
      },
      {
        name: "suppress config warnings",
        config: {
          suppressConfigWarnings: true,
        },
        assertion: ({ logs }) => {
          const log = findWarningLog(logs);
          expect(log).toBeUndefined();
        },
      },
    ],
    tools: [
      {
        name: "no tools with empty config",
        config: {},
        assertion: ({ callOptions }) => {
          expect(callOptions.tools).toBeUndefined();
        },
      },
      {
        name: "web search tools with web search config",
        config: { webSearch: { exaApiKey: "set" } },
        assertion: ({ callOptions }) => {
          expect(callOptions.tools).toBeDefined();
          expect(
            callOptions.tools?.find((tool) => tool.name === "web_search")
          ).toBeDefined();
        },
      },
      {
        name: "github tools with github config",
        config: {
          github: { appID: "set", privateKey: "set", webhookSecret: "set" },
        },
        assertion: ({ callOptions }) => {
          expect(callOptions.tools).toBeDefined();
          expect(
            callOptions.tools?.find(
              (tool) => tool.name === "github_create_pull_request"
            )
          ).toBeDefined();
        },
      },
      {
        // there's a counterpart to this test called "respond in slack" below
        name: "no slack tools with slack config when not responding in slack",
        config: {
          slack: { botToken: "test", signingSecret: "set" },
        },
        assertion: ({ callOptions }) => {
          expect(callOptions.tools).toBeUndefined();
          expect(JSON.stringify(callOptions.prompt)).not.toInclude(
            "report your Slack status"
          );
        },
      },
    ],
  } satisfies {
    [testSet: string]: {
      name: string;
      config: Parameters<typeof newAgent>[0]["core"];
      assertion: (args: {
        logs: unknown[];
        callOptions: DoStreamOptions;
      }) => Promise<void> | void;
    }[];
  };
  const testSets = Object.entries(cases).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [testSetName, cases] of testSets) {
    describe(testSetName, () => {
      for (const { name, config, assertion } of cases) {
        test(name, async () => {
          const logs: unknown[] = [];
          const appendLog = (...log: unknown[]) => {
            logs.push(...log);
          };
          const logger = {
            info: appendLog,
            warn: appendLog,
            error: appendLog,
          };
          const { promise: doStreamOptionsPromise, resolve } =
            newPromise<DoStreamOptions>();
          await using setupResult = await setup({
            core: { ...config, logger },
            model: newMockModel({
              textResponse: "config test",
              onDoStream: (options) => {
                resolve(options);
              },
            }),
          });
          const { client } = setupResult;

          const stream = await sendUserMessage(client, "sup");
          for await (const _message of stream) {
            // consume the stream
          }
          await assertion({ logs, callOptions: await doStreamOptionsPromise });
        });
      }
    });
  }
});

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test("respond in slack", async () => {
  const { promise: doStreamOptionsPromise, resolve } =
    newPromise<DoStreamOptions>();
  await using setupResult = await setup({
    core: {
      logger: noopLogger,
      slack: { botToken: "test", signingSecret: "set" },
    },
    model: newMockModel({
      textResponse: "slack test",
      onDoStream: (options) => {
        resolve(options);
      },
    }),
  });
  const { client } = setupResult;

  const stream = await sendMessages(client, [
    {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: "sup",
        },
      ],
      // the agent should detect slack metadata and act accordingly
      metadata: {
        type: "slack",
      },
    },
  ]);
  for await (const _message of stream) {
    // consume the stream
  }
  const callOptions = await doStreamOptionsPromise;
  expect(callOptions.tools).toBeDefined();
  expect(
    callOptions.tools?.find((tool) => tool.name === "slack_sendMessage")
  ).toBeDefined();
  expect(JSON.stringify(callOptions.prompt)).toInclude(
    "report your Slack status"
  );
});

// Mock Blink API server for integration tests
const createMockBlinkApiServer = () => {
  const storage: Record<string, string> = {};

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
    async sendMessages() {},
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
    [Symbol.dispose]: () => {
      server.close();
    },
  };
};

// Daytona integration test helpers
const createMockDaytonaSandbox = (
  overrides: Partial<DaytonaSandbox> = {}
): DaytonaSandbox => ({
  id: "test-workspace-id",
  state: "started",
  start: mock(() => Promise.resolve()),
  getPreviewLink: mock(() =>
    Promise.resolve({ url: "ws://localhost:9999", token: "test-token" })
  ),
  ...overrides,
});

const createMockDaytonaSdk = (
  sandbox: DaytonaSandbox = createMockDaytonaSandbox()
): DaytonaClient => ({
  get: mock(() => Promise.resolve(sandbox)),
  create: mock(() => Promise.resolve(sandbox)),
});

const withBlinkApiUrl = (url: string) => {
  const originalApiUrl = process.env.BLINK_API_URL;
  process.env.BLINK_API_URL = url;
  return {
    [Symbol.dispose]: () => {
      if (originalApiUrl) {
        process.env.BLINK_API_URL = originalApiUrl;
      } else {
        delete process.env.BLINK_API_URL;
      }
    },
  };
};

const createMockComputeServer = () => {
  const wss = new WebSocketServer({ port: 0 });
  const address = wss.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const url = `ws://localhost:${port}`;

  wss.on("connection", (ws) => {
    // Create the compute protocol server that sends responses via WebSocket
    const computeServer = new ComputeServer({
      send: (message: Uint8Array) => {
        ws.send(message);
      },
    });

    // Forward WebSocket messages to the compute server
    ws.on("message", (data: Buffer) => {
      computeServer.handleMessage(new Uint8Array(data));
    });
  });

  return {
    url,
    [Symbol.dispose]: () => {
      wss.close();
    },
  };
};

describe("daytona integration", () => {
  test("Scout creates compute tools for daytona config", async () => {
    const { promise: doStreamOptionsPromise, resolve } =
      newPromise<DoStreamOptions>();

    const mockSdk = createMockDaytonaSdk();

    await using setupResult = await setup({
      core: {
        logger: noopLogger,
        compute: {
          type: "daytona",
          options: {
            apiKey: "test-api-key",
            computeServerPort: 3000,
            snapshot: "test-snapshot",
            daytonaSdk: mockSdk,
          },
        },
      },
      model: newMockModel({
        textResponse: "daytona test",
        onDoStream: (options) => {
          resolve(options);
        },
      }),
    });
    const { client } = setupResult;

    const stream = await sendUserMessage(client, "hello");
    for await (const _message of stream) {
      // consume the stream
    }

    const callOptions = await doStreamOptionsPromise;
    expect(callOptions.tools).toBeDefined();
    expect(
      callOptions.tools?.find((tool) => tool.name === "initialize_workspace")
    ).toBeDefined();
  });

  test("initialize_workspace tool triggers daytona SDK", async () => {
    using apiServer = createMockBlinkApiServer();
    using _env = withBlinkApiUrl(apiServer.url);

    const mockSandbox = createMockDaytonaSandbox({
      id: "new-daytona-workspace",
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
      compute: {
        type: "daytona",
        options: {
          apiKey: "test-api-key",
          computeServerPort: 3000,
          snapshot: "test-snapshot",
          daytonaSdk: mockSdk,
        },
      },
    });

    const params = scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [],
      model: newMockModel({ textResponse: "test" }),
    });
    const result = streamText(params);

    // Access the tools from the result and call initialize_workspace directly
    // biome-ignore lint/suspicious/noExplicitAny: accessing internal tools for testing
    const tools = (result as any).tools as Record<
      string,
      // biome-ignore lint/suspicious/noExplicitAny: mock input
      { execute: (input: any) => Promise<string> }
    >;
    const initTool = tools.initialize_workspace;
    expect(initTool).toBeDefined();

    // Execute the tool - withModelIntent wrapper expects { model_intent, properties }
    // biome-ignore lint/style/noNonNullAssertion: we just checked it's defined
    const toolResult = await initTool!.execute({
      model_intent: "initializing workspace",
      properties: {},
    });

    expect(toolResult).toBe("Workspace initialized.");
    expect(mockSdk.create).toHaveBeenCalledTimes(1);
    expect(mockSdk.create).toHaveBeenCalledWith({
      snapshot: "test-snapshot",
      autoDeleteInterval: 60,
      envVars: undefined,
      labels: undefined,
    });

    // Verify workspace info was stored
    expect(apiServer.storage.__compute_workspace_id).toBe(
      JSON.stringify({ id: "new-daytona-workspace" })
    );
  });

  test("compute tools use daytona client to connect to workspace", async () => {
    using apiServer = createMockBlinkApiServer();
    using computeServer = createMockComputeServer();
    using _env = withBlinkApiUrl(apiServer.url);

    const mockSandbox = createMockDaytonaSandbox({
      id: "workspace-for-compute",
      getPreviewLink: mock(() =>
        Promise.resolve({ url: computeServer.url, token: "test-token" })
      ),
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
      compute: {
        type: "daytona",
        options: {
          apiKey: "test-api-key",
          computeServerPort: 2137,
          snapshot: "test-snapshot",
          daytonaSdk: mockSdk,
        },
      },
    });

    const params = scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [],
      model: newMockModel({ textResponse: "test" }),
    });
    const result = streamText(params);

    // biome-ignore lint/suspicious/noExplicitAny: accessing internal tools for testing
    const tools = (result as any).tools as Record<
      string,
      // biome-ignore lint/suspicious/noExplicitAny: mock input
      { execute: (input: any) => Promise<unknown> }
    >;

    // First, initialize the workspace
    // biome-ignore lint/style/noNonNullAssertion: we know it exists
    await tools.initialize_workspace!.execute({
      model_intent: "initializing workspace",
      properties: {},
    });

    expect(mockSdk.create).toHaveBeenCalledTimes(1);
    expect(mockSdk.get).not.toHaveBeenCalled();

    // Now call a compute tool that uses the workspace client
    // This should trigger getDaytonaWorkspaceClient which calls daytona.get()
    const readDirTool = tools.read_directory;
    expect(readDirTool).toBeDefined();

    // Call the tool - the compute server will handle the request
    // biome-ignore lint/suspicious/noExplicitAny: test result
    // biome-ignore lint/style/noNonNullAssertion: we just checked it's defined
    const readResult: any = await readDirTool!.execute({
      model_intent: "reading directory",
      properties: {
        directory_path: "/tmp",
      },
    });

    // Verify the compute server responded correctly
    expect(readResult).toBeDefined();
    expect(readResult.entries).toBeDefined();

    // Verify that the daytona SDK was used to get the workspace
    expect(mockSdk.get).toHaveBeenCalledTimes(1);
    expect(mockSdk.get).toHaveBeenCalledWith("workspace-for-compute");

    // Verify getPreviewLink was called with the correct port
    expect(mockSandbox.getPreviewLink).toHaveBeenCalledTimes(1);
    expect(mockSandbox.getPreviewLink).toHaveBeenCalledWith(2137);
  });
});
