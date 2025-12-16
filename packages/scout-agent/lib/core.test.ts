import { describe, expect, mock, test } from "bun:test";
import {
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
import { COMPACT_CONVERSATION_TOOL_NAME, type Message, Scout } from "./index";
import { createMockBlinkApiServer, withBlinkApiUrl } from "./test-helpers";

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
  test("buildStreamTextParams does not include compaction tool when under threshold", async () => {
    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: noopLogger,
    });

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
      model: newMockModel({ textResponse: "test" }),
    });

    // Verify compaction tool is NOT included when under threshold
    expect(params.tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeUndefined();
  });

  test("buildStreamTextParams applies existing compaction summary", async () => {
    const infoLogs: string[] = [];
    const mockLogger = {
      ...noopLogger,
      info: (...args: unknown[]) => {
        infoLogs.push(args.map(String).join(" "));
      },
    };

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: mockLogger,
    });

    // Create messages with an existing compaction summary
    const messagesWithCompaction: Message[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Old message 1" }],
      },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "Old response 2" }],
      },
      {
        id: "3",
        role: "user",
        parts: [{ type: "text", text: "Old message 3" }],
      },
      {
        id: "4",
        role: "assistant",
        parts: [{ type: "text", text: "Old response 4" }],
      },
      {
        id: "5",
        role: "user",
        parts: [{ type: "text", text: "Old message 5" }],
      },
      {
        id: "6",
        role: "assistant",
        parts: [{ type: "text", text: "Old response 6" }],
      },
      {
        id: "7",
        role: "assistant",
        parts: [
          {
            type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
            toolCallId: "tool-call-1",
            state: "output-available",
            input: { summary: "Summary of old messages" },
            output: { summary: "Summary of old messages" },
          } as unknown as Message["parts"][number],
        ],
      },
      {
        id: "8",
        role: "user",
        parts: [{ type: "text", text: "New message after compaction" }],
      },
    ];

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: messagesWithCompaction,
      model: newMockModel({ textResponse: "test" }),
      // Disable threshold to avoid token counting affecting message count
      compaction: {
        softThreshold: Number.MAX_SAFE_INTEGER - 1,
        hardThreshold: Number.MAX_SAFE_INTEGER,
      },
    });

    // Verify messages were processed: should have system + summary + new msg
    // The converted messages include: system prompt, compaction-summary user msg, and the new user msg
    // (compaction tool call is excluded since the summary already contains the info)
    expect(params.messages.length).toBe(3);
  });

  test("buildStreamTextParams injects compaction message when threshold exceeded", async () => {
    const warnLogs: string[] = [];
    const infoLogs: string[] = [];
    const mockLogger = {
      ...noopLogger,
      warn: (...args: unknown[]) => {
        warnLogs.push(args.map(String).join(" "));
      },
      info: (...args: unknown[]) => {
        infoLogs.push(args.map(String).join(" "));
      },
    };

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: mockLogger,
    });

    // Create a message that will exceed a very low threshold
    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [
        {
          id: "1",
          role: "user",
          parts: [
            { type: "text", text: "Hello world, this is a test message." },
          ],
        },
      ],
      model: newMockModel({ textResponse: "test" }),
      compaction: {
        // Set a very low threshold so any message exceeds it
        softThreshold: 1,
        hardThreshold: 100_000, // High hard threshold so no truncation
      },
    });

    // Verify compaction message was injected (system + user + compaction request = 3 messages)
    expect(params.messages.length).toBe(3);

    // Check that the last message contains compaction request
    const compactionRequest = params.messages.find(
      (m) =>
        m.role === "user" &&
        (typeof m.content === "string"
          ? m.content.includes("CONTEXT LIMIT")
          : Array.isArray(m.content) &&
            m.content.some(
              (c) =>
                c.type === "text" &&
                (c as { text: string }).text.includes("CONTEXT LIMIT")
            ))
    );
    expect(compactionRequest).toBeDefined();

    // Verify compaction tool IS available when compaction is triggered
    expect(params.tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeDefined();
  });

  test("buildStreamTextParams respects compaction: false to disable", async () => {
    const warnLogs: string[] = [];
    const mockLogger = {
      ...noopLogger,
      warn: (...args: unknown[]) => {
        warnLogs.push(args.map(String).join(" "));
      },
    };

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: mockLogger,
    });

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: [
        {
          id: "1",
          role: "user",
          parts: [
            { type: "text", text: "Hello world, this is a test message." },
          ],
        },
      ],
      model: newMockModel({ textResponse: "test" }),
      compaction: false,
    });

    // Compaction tool should NOT be available when compaction is disabled
    expect(params.tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeUndefined();

    // No warning should be logged even with messages
    const warningLog = warnLogs.find((l) =>
      l.includes("approaching context limit")
    );
    expect(warningLog).toBeUndefined();

    // Only system + user message (no warning injected)
    expect(params.messages.length).toBe(2);
  });

  test("buildStreamTextParams truncates messages at hard threshold during compaction", async () => {
    const warnLogs: string[] = [];
    const infoLogs: string[] = [];
    const mockLogger = {
      ...noopLogger,
      warn: (...args: unknown[]) => {
        warnLogs.push(args.map(String).join(" "));
      },
      info: (...args: unknown[]) => {
        infoLogs.push(args.map(String).join(" "));
      },
    };

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: mockLogger,
    });

    // Create many messages that will exceed soft threshold and require truncation at hard
    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `${i + 1}`,
      role: i % 2 === 0 ? "user" : "assistant",
      parts: [
        {
          type: "text",
          text: `Message ${i + 1}: This is a longer message with additional content to generate more tokens for testing purposes. ${Array(100).fill("abcdefg").join("")}`,
        },
      ],
    })) as Message[];

    const params = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages,
      model: newMockModel({ textResponse: "test" }),
      compaction: {
        // Low soft threshold to trigger compaction
        softThreshold: 1,
        // Low hard threshold to force truncation
        hardThreshold: 500,
      },
    });

    // Verify info log about truncation (when preserving messages)
    const truncationLog = infoLogs.find((l) =>
      l.includes("Compaction: sending")
    );
    expect(truncationLog).toBeDefined();

    // Verify compaction tool IS available
    expect(params.tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeDefined();

    // Verify that messages were truncated (not all 20 messages + system)
    // Should have: system + truncated messages + compaction request
    expect(params.messages.length).toBeLessThan(10);

    // Verify compaction request message is present
    const compactionRequest = params.messages.find(
      (m) =>
        m.role === "user" &&
        (typeof m.content === "string"
          ? m.content.includes("CONTEXT LIMIT")
          : Array.isArray(m.content) &&
            m.content.some(
              (c) =>
                c.type === "text" &&
                (c as { text: string }).text.includes("CONTEXT LIMIT")
            ))
    );
    expect(compactionRequest).toBeDefined();
  });

  test("compaction loop: after model summarizes, second call does not trigger another compaction", async () => {
    const infoLogs: string[] = [];
    const mockLogger = {
      ...noopLogger,
      info: (...args: unknown[]) => {
        infoLogs.push(args.map(String).join(" "));
      },
    };

    const agent = new blink.Agent<Message>();
    const scout = new Scout({
      agent,
      logger: mockLogger,
    });

    // Use thresholds that will be exceeded by original messages but not by compacted ones
    // Original messages: ~10 messages with 700 chars each = high token count
    // After compaction: summary + preserved messages should be under soft threshold
    const softThreshold = 2000;
    const hardThreshold = 3000;

    // Step 1: Create large messages that will exceed soft threshold
    // Each message has ~700 characters of filler to generate significant tokens
    const filler = Array(100).fill("abcdefg").join("");
    const originalMessages: Message[] = Array.from({ length: 10 }, (_, i) => ({
      id: `${i + 1}`,
      role: i % 2 === 0 ? "user" : "assistant",
      parts: [
        {
          type: "text",
          text: `Message ${i + 1}: ${filler}`,
        },
      ],
    })) as Message[];

    // Create a mock model that returns a tool call to compact_conversation
    // The tool is wrapped with withModelIntent, so input needs model_intent and properties
    const summaryText = "Brief summary of the conversation.";
    const mockModelWithToolCall = new MockLanguageModelV2({
      doStream: async () => {
        return {
          stream: simulateReadableStream({
            chunks: [
              {
                type: "tool-call" as const,
                toolName: COMPACT_CONVERSATION_TOOL_NAME,
                toolCallId: "tool-call-1",
                input: JSON.stringify({
                  model_intent: "Compacting conversation history",
                  properties: { summary: summaryText },
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
        };
      },
    });

    // First call - should trigger compaction, model responds with tool call
    const firstParams = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: originalMessages,
      model: mockModelWithToolCall,
      compaction: { softThreshold, hardThreshold },
    });

    // Verify compaction was triggered
    expect(firstParams.tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeDefined();

    // Execute streamText and wait for completion (including tool execution)
    const firstResult = streamText(firstParams);

    // Wait for the full result including tool calls and their results
    const toolCalls = await firstResult.toolCalls;
    const toolResults = await firstResult.toolResults;

    // Verify the model called the compaction tool
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.toolName).toBe(COMPACT_CONVERSATION_TOOL_NAME);
    expect(toolResults).toHaveLength(1);

    // The tool should have executed and returned a summary
    // biome-ignore lint/suspicious/noExplicitAny: test typing
    const toolResult = toolResults[0] as any;
    expect(toolResult?.output).toBeDefined();
    // The output contains the summary from the compaction tool
    expect(toolResult?.output?.summary).toBe(summaryText);

    // Now build the assistant message with the completed tool call
    // biome-ignore lint/suspicious/noExplicitAny: test typing
    const toolCall = toolCalls[0] as any;
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [
        {
          type: `tool-${COMPACT_CONVERSATION_TOOL_NAME}`,
          toolCallId: toolCall?.toolCallId ?? "tool-1",
          state: "output-available",
          // The input has model_intent wrapper, but we store the unwrapped version
          input: { summary: summaryText },
          output: toolResult?.output,
        } as Message["parts"][number],
      ],
    };

    // Construct the full message history as it would be after the first turn
    // Original messages + compaction request + assistant's tool call response
    const messagesForSecondCall: Message[] = [
      ...originalMessages,
      {
        id: "compaction-request",
        role: "user",
        parts: [
          {
            type: "text",
            text: "[SYSTEM NOTICE - CONTEXT LIMIT] Please call compact_conversation tool NOW",
          },
        ],
      },
      // The assistant's response with the completed tool call
      assistantMessage,
    ];

    // Clear logs before second call
    infoLogs.length = 0;

    // Step 2: Second call - after compaction is applied, should NOT trigger another compaction
    const secondParams = await scout.buildStreamTextParams({
      chatID: "test-chat-id" as blink.ID,
      messages: messagesForSecondCall,
      model: newMockModel({ textResponse: "Continuing the conversation..." }),
      compaction: { softThreshold, hardThreshold },
    });

    // After applying compaction:
    // - Original 10 messages + compaction request should be replaced by summary
    // - Only summary message + tool call message remain
    // - Token count should be much lower now

    // Verify NO new compaction was triggered
    const secondCompactionRequest = secondParams.messages.find(
      (m) =>
        m.role === "user" &&
        (typeof m.content === "string"
          ? m.content.includes("CONTEXT LIMIT")
          : Array.isArray(m.content) &&
            m.content.some(
              (c) =>
                c.type === "text" &&
                (c as { text: string }).text.includes("CONTEXT LIMIT")
            ))
    );
    expect(secondCompactionRequest).toBeUndefined();

    // Compaction tool should NOT be included since we're under threshold after applying summary
    expect(secondParams.tools[COMPACT_CONVERSATION_TOOL_NAME]).toBeUndefined();

    // Verify the summary message is present (compaction was applied)
    const summaryMessage = secondParams.messages.find(
      (m) =>
        m.role === "user" &&
        (typeof m.content === "string"
          ? m.content.includes("CONVERSATION SUMMARY")
          : Array.isArray(m.content) &&
            m.content.some(
              (c) =>
                c.type === "text" &&
                (c as { text: string }).text.includes("CONVERSATION SUMMARY")
            ))
    );
    expect(summaryMessage).toBeDefined();

    // No "approaching context limit" log should appear in second call
    const contextLimitLog = infoLogs.find((l) =>
      l.includes("approaching context limit")
    );
    expect(contextLimitLog).toBeUndefined();
  });
});
