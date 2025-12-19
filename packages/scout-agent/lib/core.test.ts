import { describe, expect, mock, test } from "bun:test";
import {
  APICallError,
  readUIMessageStream,
  simulateReadableStream,
  streamText,
  type UIMessage,
} from "ai";
import { MockLanguageModelV2 } from "ai/test";
import * as blink from "blink";
import { Client } from "blink/client";
import { getWorkspaceInfoKey } from "./compute/common";
import {
  createMockCoderClient,
  createMockComputeServer,
  createMockDaytonaSandbox,
  createMockDaytonaSdk,
  mockCoderWorkspace,
  noopLogger,
} from "./compute/test-utils";
import { type Message, Scout } from "./index";
import {
  createAgentTestHelper,
  createMockBlinkApiServer,
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
  streamError,
  throwError,
}: {
  textResponse?: string;
  onDoStream?: (args: DoStreamOptions) => Promise<void> | void;
  /** Error to emit in the stream after some text (simulates mid-stream error) */
  streamError?: Error;
  /** Error to throw from doStream (simulates immediate error) */
  throwError?: Error;
}) => {
  return new MockLanguageModelV2({
    doStream: async (options) => {
      await onDoStream?.(options);

      if (throwError) {
        throw throwError;
      }

      if (streamError) {
        // Create a stream that emits some text then errors
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-start", id: "text-1" });
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: "Hello",
              });
              controller.error(streamError);
            },
          }),
        };
      }

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: textResponse ?? "" },
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
        name: "only compact_conversation tool with empty config",
        config: {},
        assertion: ({ callOptions }) => {
          // Only the compact_conversation tool should be present (enabled by default)
          expect(callOptions.tools).toBeDefined();
          expect(callOptions.tools).toHaveLength(1);
          expect(callOptions.tools?.[0]?.name).toBe("compact_conversation");
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
          // Only the compact_conversation tool should be present (no slack tools when not responding in slack)
          expect(callOptions.tools).toBeDefined();
          expect(callOptions.tools).toHaveLength(1);
          expect(callOptions.tools?.[0]?.name).toBe("compact_conversation");
          expect(
            callOptions.tools?.find((tool) => tool.name.startsWith("slack_"))
          ).toBeUndefined();
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

    const chatID = "test-chat-id" as blink.ID;
    const params = await scout.buildStreamTextParams({
      chatID,
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
    expect(apiServer.storage[getWorkspaceInfoKey(chatID)]).toBe(
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

describe("coder integration", () => {
  test("Scout creates compute tools for coder config", async () => {
    const { promise: doStreamOptionsPromise, resolve } =
      newPromise<DoStreamOptions>();

    const mockClient = createMockCoderClient();

    await using setupResult = await setup({
      core: {
        logger: noopLogger,
        compute: {
          type: "coder",
          options: {
            url: "http://coder.example.com",
            sessionToken: "test-session-token",
            computeServerPort: 22137,
            template: "test-template",
            coderClient: mockClient,
          },
        },
      },
      model: newMockModel({
        textResponse: "coder test",
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

  test("initialize_workspace tool triggers coder client", async () => {
    using apiServer = createMockBlinkApiServer();
    using computeServer = createMockComputeServer();
    using _env = withBlinkApiUrl(apiServer.url);

    const mockClient = createMockCoderClient({
      getWorkspaceByOwnerAndName: mock(() => Promise.resolve(undefined)),
      createWorkspace: mock(() =>
        Promise.resolve(mockCoderWorkspace({ id: "new-coder-workspace" }))
      ),
      getWorkspace: mock(() =>
        Promise.resolve(mockCoderWorkspace({ id: "new-coder-workspace" }))
      ),
      getAppHost: mock(() =>
        Promise.resolve(`localhost:${computeServer.port}`)
      ),
    });

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
      compute: {
        type: "coder",
        options: {
          url: "http://coder.example.com",
          sessionToken: "test-session-token",
          computeServerPort: 22137,
          template: "test-template",
          coderClient: mockClient,
          pollingIntervalMs: 10,
          computeServerPollingIntervalMs: 10,
        },
      },
    });

    const chatID = "test-chat-id" as blink.ID;
    const params = await scout.buildStreamTextParams({
      chatID,
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

    expect(toolResult).toBe('Workspace "testuser/test-workspace" initialized.');
    expect(mockClient.createWorkspace).toHaveBeenCalledTimes(1);

    // Verify workspace info was stored
    const storedValue = apiServer.storage[getWorkspaceInfoKey(chatID)];
    expect(storedValue).toBeDefined();
    const storedInfo = JSON.parse(storedValue as string);
    expect(storedInfo.workspaceId).toBe("new-coder-workspace");
  });

  test("compute tools use coder client to connect to workspace", async () => {
    using apiServer = createMockBlinkApiServer();
    using computeServer = createMockComputeServer();
    using _env = withBlinkApiUrl(apiServer.url);

    const mockClient = createMockCoderClient({
      getWorkspaceByOwnerAndName: mock(() => Promise.resolve(undefined)),
      createWorkspace: mock(() =>
        Promise.resolve(mockCoderWorkspace({ id: "workspace-for-compute" }))
      ),
      getWorkspace: mock(() =>
        Promise.resolve(mockCoderWorkspace({ id: "workspace-for-compute" }))
      ),
      getAppHost: mock(() =>
        Promise.resolve(`localhost:${computeServer.port}`)
      ),
    });

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
      compute: {
        type: "coder",
        options: {
          url: "http://coder.example.com",
          sessionToken: "test-session-token",
          computeServerPort: 2137,
          template: "test-template",
          coderClient: mockClient,
          pollingIntervalMs: 10,
          computeServerPollingIntervalMs: 10,
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

    expect(mockClient.createWorkspace).toHaveBeenCalledTimes(1);
    // Note: getWorkspace is called during initialization for polling (waitForWorkspaceReady)
    const callsAfterInit = (mockClient.getWorkspace as ReturnType<typeof mock>)
      .mock.calls.length;

    // Now call a compute tool that uses the workspace client
    // This should trigger getCoderWorkspaceClient which calls getWorkspace()
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

    // Verify that the coder client was used to get the workspace (one more call than during init)
    expect(
      (mockClient.getWorkspace as ReturnType<typeof mock>).mock.calls.length
    ).toBe(callsAfterInit + 1);
    expect(mockClient.getWorkspace).toHaveBeenCalledWith(
      "workspace-for-compute"
    );

    // Verify getAppHost was called (may be called multiple times during init and client creation)
    expect(mockClient.getAppHost).toHaveBeenCalled();
  });
});

describe("compaction", () => {
  // Shared helpers for compaction tests
  const createContextApiError = (
    message = "Input is too long for requested model"
  ) =>
    new APICallError({
      message,
      url: "https://api.example.com",
      requestBodyValues: {},
      statusCode: 400,
    });

  /** Check if a message contains the compaction marker */
  const hasCompactionMarker = (msg: UIMessage) =>
    msg.parts.some(
      (p) =>
        p.type === "tool-__compaction_marker" ||
        ((p as { type: string; toolName?: string }).type === "dynamic-tool" &&
          (p as { toolName?: string }).toolName === "__compaction_marker")
    );

  /** Check if a message contains the compact_conversation tool call */
  const hasCompactTool = (msg: UIMessage) =>
    msg.parts.some(
      (p: { type: string; toolName?: string }) =>
        p.type === "tool-compact_conversation" ||
        (p.type === "dynamic-tool" && p.toolName === "compact_conversation")
    );

  /** Create a mock response that emits an out-of-context APICallError */
  const createContextErrorResponse = () => ({
    stream: simulateReadableStream({
      chunks: [{ type: "error" as const, error: createContextApiError() }],
    }),
  });

  /** Create a mock response that emits text before an out-of-context error */
  const createMidStreamContextErrorResponse = () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start" as const, id: "text-1" },
        { type: "text-delta" as const, id: "text-1", delta: "partial text" },
        { type: "error" as const, error: createContextApiError() },
      ],
    }),
  });

  /** Create a mock response that calls the compact_conversation tool */
  const createCompactToolResponse = (
    summary: string,
    toolCallId = "compact-tool-call-1"
  ) => ({
    stream: simulateReadableStream({
      chunks: [
        {
          type: "tool-call" as const,
          toolCallType: "function" as const,
          toolCallId,
          toolName: "compact_conversation",
          input: JSON.stringify({
            model_intent: "Compacting conversation history",
            properties: { summary },
          }),
        },
        {
          type: "finish" as const,
          finishReason: "tool-calls" as const,
          logprobs: undefined,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      ],
    }),
  });

  /** Create a mock response with success text */
  const createTextResponse = (text: string) => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start" as const, id: "text-1" },
        { type: "text-delta" as const, id: "text-1", delta: text },
        { type: "text-end" as const, id: "text-1" },
        {
          type: "finish" as const,
          finishReason: "stop" as const,
          logprobs: undefined,
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ],
    }),
  });

  /** Set up agent with scout and chat handler for a given model */
  const setupCompactionTest = (
    model: MockLanguageModelV2,
    chatID = "test-chat-id" as blink.ID
  ) => {
    const agent = new blink.Agent<Message>();
    const scout = new Scout({ agent, logger: noopLogger });
    agent.on("chat", async ({ messages }) => {
      const params = await scout.buildStreamTextParams({
        systemPrompt: "<system>hello</system>",
        chatID,
        messages,
        model,
      });
      return streamText({
        ...params,
        // by default, streamText prints all errors to console.error, which is noisy in tests
        onError: () => {},
      });
    });
    return { agent, scout, chatID };
  };

  /** Extract all text content from buildStreamTextParams result */
  const extractAllContent = (params: {
    messages: Array<{
      content: string | Array<{ type: string; text?: string }>;
    }>;
  }) =>
    params.messages
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("");
        }
        return "";
      })
      .join(" ");

  /** Get the text from a text part in a message */
  const getTextFromMessage = (msg: UIMessage): string | undefined => {
    const textPart = msg.parts.find((p: { type: string }) => p.type === "text");
    return textPart ? (textPart as { text: string }).text : undefined;
  };

  const createCompactionSummaryMessage = (id: string): Message => ({
    id,
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "compact_conversation",
        toolCallId: `${id}-call`,
        state: "output-available",
        input: { summary: "Test summary" },
        output: {
          summary: "Test summary",
          compacted_at: "2024-01-01T00:00:00Z",
        },
      } as Message["parts"][number],
    ],
  });

  test("buildStreamTextParams always includes compact_conversation tool by default", async () => {
    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
    });

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [],
      model: newMockModel({ textResponse: "test" }),
    });

    // Check compact_conversation tool is included
    expect(params.tools.compact_conversation).toBeDefined();
  });

  test("buildStreamTextParams excludes compact_conversation tool when compaction disabled", async () => {
    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
    });

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [],
      model: newMockModel({ textResponse: "test" }),
      compaction: false,
    });

    // Check compact_conversation tool is NOT included
    expect(params.tools.compact_conversation).toBeUndefined();
  });

  test("buildStreamTextParams disables compaction after repeated compaction attempts", async () => {
    const warn = mock();
    const logger = { ...noopLogger, warn };
    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger,
    });

    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      createCompactionSummaryMessage("summary-1"),
      createCompactionSummaryMessage("summary-2"),
      createCompactionSummaryMessage("summary-3"),
      createCompactionSummaryMessage("summary-4"),
      createCompactionSummaryMessage("summary-5"),
    ];

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages,
      model: newMockModel({ textResponse: "test" }),
    });

    expect(params.tools.compact_conversation).toBeUndefined();
    expect(params.experimental_transform).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  test("buildStreamTextParams disables compaction when exclusion would leave insufficient messages", async () => {
    const warn = mock();
    const logger = { ...noopLogger, warn };
    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger,
    });

    // Create messages with insufficient content to summarize after exclusion
    // With 1 marker, retryCount=0, so 1 message will be excluded, leaving 0 messages
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Only message" }],
      },
      {
        id: "marker-msg",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "__compaction_marker",
            toolCallId: "marker-1",
            state: "output-available",
            input: {
              model_intent: "Out of context, compaction in progress...",
            },
            output: "marker",
          } as Message["parts"][number],
        ],
      },
    ];

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages,
      model: newMockModel({ textResponse: "test" }),
    });

    expect(params.tools.compact_conversation).toBeUndefined();
    expect(params.experimental_transform).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  test("e2e: complete compaction flow using scout methods directly", async () => {
    let modelCallCount = 0;

    // Call 1: context error, Call 2: compact_conversation, Call 3: success
    const model = new MockLanguageModelV2({
      doStream: async () => {
        modelCallCount++;
        if (modelCallCount === 1) return createContextErrorResponse();
        if (modelCallCount === 2)
          return createCompactToolResponse(
            "Previous conversation summary from model."
          );
        return createTextResponse("Success after compaction");
      },
    });

    const { agent, scout, chatID } = setupCompactionTest(model);

    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Old message 1" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Old response 1" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "New question" }],
        },
      ],
    });

    // Step 1: context error → compaction marker
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);
    expect(modelCallCount).toBe(1);

    // Step 2: model calls compact_conversation
    const result2 = await helper.runChatTurn();
    expect(hasCompactTool(result2.assistantMessage)).toBe(true);
    expect(modelCallCount).toBe(2);

    // Step 3: success
    helper.addUserMessage("Follow-up question");
    const result3 = await helper.runChatTurn();
    expect(getTextFromMessage(result3.assistantMessage)).toBe(
      "Success after compaction"
    );
    expect(modelCallCount).toBe(3);

    // Verify compaction: old messages removed, summary + excluded restored
    const params = await scout.buildStreamTextParams({
      chatID,
      messages: helper.messages as Message[],
      model,
    });
    const allContent = extractAllContent(params);

    expect(allContent).toContain("CONVERSATION SUMMARY");
    expect(allContent).toContain("Previous conversation summary from model");
    expect(allContent).toContain("New question"); // excluded and restored
    expect(allContent).not.toContain("Old message 1"); // summarized
    expect(allContent).not.toContain("Old response 1"); // summarized
    expect(allContent).toContain("Follow-up question"); // added after
  });

  test("e2e: user message submitted during compaction appears after excluded messages", async () => {
    let modelCallCount = 0;

    // Calls 1-2: context errors, Call 3: compact, Call 4: success
    const model = new MockLanguageModelV2({
      doStream: async () => {
        modelCallCount++;
        if (modelCallCount <= 2) return createContextErrorResponse();
        if (modelCallCount === 3)
          return createCompactToolResponse("Summary of the old conversation.");
        return createTextResponse("Response after compaction");
      },
    });

    const { agent, scout, chatID } = setupCompactionTest(model);

    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "First message to summarize" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "First response to summarize" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Second message to summarize" }],
        },
        {
          id: "msg-4",
          role: "assistant",
          parts: [{ type: "text", text: "Second response - will be excluded" }],
        },
        {
          id: "msg-5",
          role: "user",
          parts: [{ type: "text", text: "Third message - will be excluded" }],
        },
      ],
    });

    // Steps 1-2: context errors → markers
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);
    const result2 = await helper.runChatTurn();
    expect(hasCompactionMarker(result2.assistantMessage)).toBe(true);

    // User submits message during compaction
    helper.addUserMessage("User message submitted during compaction");

    // Step 3: compact_conversation, Step 4: success
    await helper.runChatTurn();
    const result4 = await helper.runChatTurn();
    expect(getTextFromMessage(result4.assistantMessage)).toBe(
      "Response after compaction"
    );

    // Verify message structure
    const params = await scout.buildStreamTextParams({
      chatID,
      messages: helper.messages as Message[],
      model,
    });
    const allContent = extractAllContent(params);

    expect(allContent).toContain("CONVERSATION SUMMARY");
    expect(allContent).toContain("Summary of the old conversation");
    expect(allContent).toContain("Third message - will be excluded");
    expect(allContent).not.toContain("First message to summarize");
    expect(allContent).not.toContain("First response to summarize");
    expect(allContent).not.toContain("Second message to summarize");
    expect(allContent).toContain("User message submitted during compaction");

    // Verify order: summary < excluded < user's new message
    const summaryIndex = allContent.indexOf("CONVERSATION SUMMARY");
    const excludedIndex = allContent.indexOf(
      "Third message - will be excluded"
    );
    const userMsgIndex = allContent.indexOf(
      "User message submitted during compaction"
    );
    expect(summaryIndex).toBeLessThan(excludedIndex);
    expect(excludedIndex).toBeLessThan(userMsgIndex);
  });

  test("e2e: non-context error during compaction does not increase exclusion count", async () => {
    let modelCallCount = 0;

    // Call 1: context error, Call 2: network error, Call 3: compact, Call 4: success
    const model = new MockLanguageModelV2({
      doStream: async () => {
        modelCallCount++;
        if (modelCallCount === 1) return createContextErrorResponse();
        if (modelCallCount === 2)
          throw new Error("network_error: connection refused");
        if (modelCallCount === 3)
          return createCompactToolResponse("Summary after non-context error.");
        return createTextResponse("Success after compaction");
      },
    });

    const { agent, scout, chatID } = setupCompactionTest(model);

    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "First message to summarize" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "First response to summarize" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Second message to summarize" }],
        },
      ],
    });

    // Step 1: context error → marker
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);

    // Step 2: non-context error → should propagate (not produce marker)
    await expect(helper.runChatTurn()).rejects.toThrow();

    // User retries, then compact and success
    helper.addMessage("assistant", "Retry after network error");
    await helper.runChatTurn();
    const result4 = await helper.runChatTurn();
    expect(getTextFromMessage(result4.assistantMessage)).toBe(
      "Success after compaction"
    );

    // Verify: only 1 marker, so excludeCount=1
    const params = await scout.buildStreamTextParams({
      chatID,
      systemPrompt: "system",
      messages: helper.messages as Message[],
      model,
    });
    const allContent = extractAllContent(params);

    expect(allContent).toContain("CONVERSATION SUMMARY");
    expect(allContent).toContain("Summary after non-context error");
    expect(allContent).not.toContain("Second message to summarize"); // restored
    expect(allContent).not.toContain("First message to summarize"); // summarized
    expect(allContent).not.toContain("First response to summarize"); // summarized
    expect(allContent).toContain("Retry after network error"); // added after
  });

  test("e2e: error before streaming triggers compaction marker", async () => {
    let modelCallCount = 0;

    // Call 1: context error, Call 2: compact, Call 3: success
    const model = new MockLanguageModelV2({
      doStream: async () => {
        modelCallCount++;
        if (modelCallCount === 1) return createContextErrorResponse();
        if (modelCallCount === 2)
          return createCompactToolResponse("Error recovery summary.");
        return createTextResponse("Success after error recovery");
      },
    });

    const { agent } = setupCompactionTest(model);

    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "First message" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "First response" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Second message" }],
        },
      ],
    });

    // Step 1: error → marker
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);

    // Step 2: compact_conversation
    const result2 = await helper.runChatTurn();
    expect(hasCompactTool(result2.assistantMessage)).toBe(true);

    // Step 3: success
    helper.addUserMessage("Follow-up after error");
    const result3 = await helper.runChatTurn();
    expect(getTextFromMessage(result3.assistantMessage)).toBe(
      "Success after error recovery"
    );
  });

  test("e2e: mid-stream error via controller.error() triggers compaction marker", async () => {
    let modelCallCount = 0;

    // Call 1: mid-stream error via controller.error(), Call 2: compact, Call 3: success
    const model = new MockLanguageModelV2({
      doStream: async () => {
        modelCallCount++;
        if (modelCallCount === 1) {
          // Stream that emits some chunks, then errors mid-stream
          return createMidStreamContextErrorResponse();
        }
        if (modelCallCount === 2)
          return createCompactToolResponse(
            "Mid-stream error recovery summary."
          );
        return createTextResponse("Success after mid-stream error recovery");
      },
    });

    const { agent } = setupCompactionTest(model);

    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "First message" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "First response" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Second message" }],
        },
      ],
    });

    // Step 1: mid-stream error → marker
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);

    // Step 2: compact_conversation
    const result2 = await helper.runChatTurn();
    expect(hasCompactTool(result2.assistantMessage)).toBe(true);

    // Step 3: success
    helper.addUserMessage("Follow-up after mid-stream error");
    const result3 = await helper.runChatTurn();
    expect(getTextFromMessage(result3.assistantMessage)).toBe(
      "Success after mid-stream error recovery"
    );
  });

  test("e2e: handles multiple compaction cycles in long conversation", async () => {
    let modelCallCount = 0;
    const capturedMessages: string[][] = []; // capture messages for each call

    // Model that goes through two complete compaction cycles
    const model = new MockLanguageModelV2({
      doStream: async (options) => {
        modelCallCount++;
        // Capture message content for verification
        const messageContents = options.prompt.map((m) => {
          if (typeof m.content === "string") return m.content;
          if (Array.isArray(m.content))
            return m.content.map((p) => ("text" in p ? p.text : "")).join("");
          return "";
        });
        capturedMessages.push(messageContents);

        // Cycle 1: calls 1-3
        if (modelCallCount === 1) return createContextErrorResponse();
        if (modelCallCount === 2)
          return createCompactToolResponse(
            "First compaction summary from cycle 1."
          );
        if (modelCallCount === 3)
          return createTextResponse("First cycle complete");
        // Cycle 2: calls 4-6
        if (modelCallCount === 4) return createContextErrorResponse();
        if (modelCallCount === 5)
          return createCompactToolResponse(
            "Second compaction summary from cycle 2.",
            "compact-tool-call-2"
          );
        if (modelCallCount === 6)
          return createTextResponse("Second cycle complete");
        return createTextResponse("Unexpected call");
      },
    });

    const { agent, scout, chatID } = setupCompactionTest(model);

    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Initial message 1" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [{ type: "text", text: "Initial response 1" }],
        },
        {
          id: "msg-3",
          role: "user",
          parts: [{ type: "text", text: "Initial message 2" }],
        },
      ],
    });

    // Cycle 1: error → compact → success
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);
    await helper.runChatTurn(); // compact_conversation
    helper.addUserMessage("Question after first compaction");
    await helper.runChatTurn(); // success

    // Verify compaction instruction was injected for cycle 1 (call 2)
    const call2Content = capturedMessages[1]?.join(" ") ?? "";
    expect(call2Content).toContain("SYSTEM NOTICE - CONTEXT LIMIT");
    expect(call2Content).toContain("compact_conversation");

    // Verify first cycle summary
    let params = await scout.buildStreamTextParams({
      chatID,
      messages: helper.messages as Message[],
      model,
    });
    expect(extractAllContent(params)).toContain(
      "First compaction summary from cycle 1"
    );

    // Build up context again
    helper.addUserMessage("Building up context - message 1");
    helper.addUserMessage("Building up context - message 2");
    helper.addUserMessage("Building up context - message 3");

    // Cycle 2: error → compact → success
    const result4 = await helper.runChatTurn();
    expect(hasCompactionMarker(result4.assistantMessage)).toBe(true);
    await helper.runChatTurn(); // compact_conversation
    helper.addUserMessage("Question after second compaction");
    await helper.runChatTurn(); // success

    // Verify compaction instruction was injected for cycle 2 (call 5)
    const call5Content = capturedMessages[4]?.join(" ") ?? "";
    expect(call5Content).toContain("SYSTEM NOTICE - CONTEXT LIMIT");
    expect(call5Content).toContain("compact_conversation");
    // Should also contain the previous summary as context
    expect(call5Content).toContain("First compaction summary from cycle 1");

    // Verify final state: second summary present, first gone
    params = await scout.buildStreamTextParams({
      chatID,
      messages: helper.messages as Message[],
      model,
    });
    const allContent = extractAllContent(params);
    expect(allContent).toContain("Second compaction summary from cycle 2");
    expect(allContent).not.toContain("First compaction summary from cycle 1");
  });

  test("e2e: excluded messages are restored after successful compaction", async () => {
    let modelCallCount = 0;

    // Call 1: context error, Call 2: compact, Call 3: success
    const model = new MockLanguageModelV2({
      doStream: async () => {
        modelCallCount++;
        if (modelCallCount === 1) return createContextErrorResponse();
        if (modelCallCount === 2)
          return createCompactToolResponse("Summary of conversation so far.");
        return createTextResponse("Final response");
      },
    });

    const { agent, scout, chatID } = setupCompactionTest(model);

    // With 1 marker (retryCount=0), 1 message will be excluded (most recent)
    await using helper = createAgentTestHelper(agent, {
      initialMessages: [
        {
          id: "summarized-1",
          role: "user",
          parts: [{ type: "text", text: "First message to be summarized" }],
        },
        {
          id: "summarized-2",
          role: "assistant",
          parts: [{ type: "text", text: "Response that will be summarized" }],
        },
        {
          id: "summarized-3",
          role: "user",
          parts: [{ type: "text", text: "Another message to summarize" }],
        },
        {
          id: "excluded-msg",
          role: "user",
          parts: [
            {
              type: "text",
              text: "This message will be excluded during compaction",
            },
          ],
        },
      ],
    });

    // Step 1: error → marker, Step 2: compact, Step 3: success
    const result1 = await helper.runChatTurn();
    expect(hasCompactionMarker(result1.assistantMessage)).toBe(true);
    await helper.runChatTurn();
    helper.addUserMessage("Follow-up question");
    await helper.runChatTurn();

    // Verify excluded message is restored after summary
    const params = await scout.buildStreamTextParams({
      chatID,
      messages: helper.messages as Message[],
      model,
    });
    const allContent = extractAllContent(params);

    expect(allContent).toContain("CONVERSATION SUMMARY");
    expect(allContent).toContain("Summary of conversation so far");
    expect(allContent).toContain(
      "This message will be excluded during compaction"
    );
    expect(allContent).toContain("Follow-up question");

    // Verify order: summary comes before excluded message
    const summaryIndex = allContent.indexOf("CONVERSATION SUMMARY");
    const excludedIndex = allContent.indexOf(
      "This message will be excluded during compaction"
    );
    expect(summaryIndex).toBeLessThan(excludedIndex);
  });
});
