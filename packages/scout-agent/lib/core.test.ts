import { describe, expect, mock, test } from "bun:test";
import { Server as ComputeServer } from "@blink-sdk/compute-protocol/server";
import {
  readUIMessageStream,
  simulateReadableStream,
  streamText,
  type UIMessage,
} from "ai";
import { MockLanguageModelV2 } from "ai/test";
import * as blink from "blink";
import { Client } from "blink/client";
import { WebSocketServer } from "ws";
import type { DaytonaClient, DaytonaSandbox } from "./compute/daytona/index";
import { type Message, Scout } from "./index";
import {
  createMockBlinkApiServer,
  noopLogger,
  withBlinkApiUrl,
} from "./test-helpers";

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
    const params = await core.buildStreamTextParams({
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
          // No warnings when config is not provided at all
          const log = findWarningLog(logs);
          expect(log).toBeUndefined();
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
            "GitHub is not configured. The `privateKey` and `webhookSecret` config fields are undefined. You may remove the `github` config object to suppress this warning."
          );
        },
      },
      {
        name: "multiple partial configs",
        config: {
          github: {
            appID: "set",
            privateKey: undefined,
            webhookSecret: undefined,
          },
          slack: {
            botToken: undefined,
            signingSecret: "set",
          },
          webSearch: {
            exaApiKey: undefined,
          },
        },
        assertion: ({ logs }) => {
          const log = findWarningLog(logs);
          expect(log).toBeDefined();
          expect(log).toInclude(
            "GitHub is not configured. The `privateKey` and `webhookSecret` config fields are undefined. You may remove the `github` config object to suppress this warning."
          );
          expect(log).toInclude(
            "Slack is not configured. The `botToken` config field is undefined. You may remove the `slack` config object to suppress this warning."
          );
          expect(log).toInclude(
            "Web search is not configured. The `exaApiKey` config field is undefined. You may remove the `webSearch` config object to suppress this warning."
          );
        },
      },
      {
        name: "full slack config",
        config: { slack: { botToken: "test", signingSecret: "set" } },
        assertion: ({ logs }) => {
          // No warnings when slack config is fully provided
          const log = findWarningLog(logs);
          expect(log).not.toInclude("Slack is not configured");
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

test("buildStreamTextParams honors getGithubAppContext param", async () => {
  const mockGetGithubAppContext = mock(() =>
    Promise.resolve({
      appId: "custom-app-id",
      privateKey: "custom-private-key",
    })
  );

  const agent = new blink.Agent<Message>();
  const scout = new Scout({
    agent,
    logger: noopLogger,
    github: {
      appID: "config-app-id",
      privateKey: "config-private-key",
      webhookSecret: "config-webhook-secret",
    },
  });

  const params = await scout.buildStreamTextParams({
    chatID: "test-chat-id" as blink.ID,
    messages: [],
    model: newMockModel({ textResponse: "test" }),
    getGithubAppContext: mockGetGithubAppContext,
  });

  // Verify GitHub tools are available
  expect(params.tools.github_create_pull_request).toBeDefined();

  const result = streamText(params);

  // Access the tools from the streamText result
  // biome-ignore lint/suspicious/noExplicitAny: accessing internal tools for testing
  const tools = (result as any).tools as Record<
    string,
    // biome-ignore lint/suspicious/noExplicitAny: mock input
    { execute: (input: any, opts?: any) => Promise<unknown> }
  >;

  // Execute a GitHub tool to verify our custom getGithubAppContext is called
  const tool = tools.github_create_pull_request;
  expect(tool).toBeDefined();

  // The tool will fail when trying to authenticate (since we're using fake credentials),
  // but we can verify our mock was called before that happens
  try {
    // biome-ignore lint/style/noNonNullAssertion: we just checked it's defined
    await tool!.execute(
      {
        model_intent: "creating pull request",
        properties: {
          owner: "test-owner",
          repo: "test-repo",
          base: "main",
          head: "feature",
          title: "Test PR",
        },
      },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "test-tool-call",
        messages: [],
      }
    );
  } catch {
    // Expected to fail during authentication
  }

  // Verify our custom getGithubAppContext was called, not the default factory
  expect(mockGetGithubAppContext).toHaveBeenCalledTimes(1);
});

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

    const params = await scout.buildStreamTextParams({
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

    const params = await scout.buildStreamTextParams({
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

  test("compute tools honor getGithubAppContext param", async () => {
    using apiServer = createMockBlinkApiServer();
    using computeServer = createMockComputeServer();
    using _env = withBlinkApiUrl(apiServer.url);

    const mockGetGithubAppContext = mock(() =>
      Promise.resolve({
        appId: "custom-app-id",
        privateKey: "custom-private-key",
      })
    );

    const mockSandbox = createMockDaytonaSandbox({
      id: "workspace-for-git-auth",
      getPreviewLink: mock(() =>
        Promise.resolve({ url: computeServer.url, token: "test-token" })
      ),
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
      github: {
        appID: "config-app-id",
        privateKey: "config-private-key",
        webhookSecret: "config-webhook-secret",
      },
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

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [],
      model: newMockModel({ textResponse: "test" }),
      getGithubAppContext: mockGetGithubAppContext,
    });
    const result = streamText(params);

    // biome-ignore lint/suspicious/noExplicitAny: accessing internal tools for testing
    const tools = (result as any).tools as Record<
      string,
      // biome-ignore lint/suspicious/noExplicitAny: mock input
      { execute: (input: any, opts?: any) => Promise<unknown> }
    >;

    // First, initialize the workspace (required before workspace_authenticate_git)
    // biome-ignore lint/style/noNonNullAssertion: we know it exists
    await tools.initialize_workspace!.execute({
      model_intent: "initializing workspace",
      properties: {},
    });

    // Verify workspace_authenticate_git tool is available
    const gitAuthTool = tools.workspace_authenticate_git;
    expect(gitAuthTool).toBeDefined();

    // Execute workspace_authenticate_git - it will fail when trying to authenticate
    // with GitHub (since we're using fake credentials), but our mock should be called first
    try {
      // biome-ignore lint/style/noNonNullAssertion: we just checked it's defined
      await gitAuthTool!.execute(
        {
          model_intent: "authenticating git",
          properties: {
            owner: "test-owner",
            repos: ["test-repo"],
          },
        },
        {
          abortSignal: new AbortController().signal,
          toolCallId: "git-auth-tool-call",
          messages: [],
        }
      );
    } catch {
      // Expected to fail during GitHub authentication
    }

    // Verify our custom getGithubAppContext was called, not the default factory
    expect(mockGetGithubAppContext).toHaveBeenCalledTimes(1);
  });
});
