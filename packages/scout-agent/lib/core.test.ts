import { describe, expect, test } from "bun:test";
import {
  readUIMessageStream,
  simulateReadableStream,
  type UIMessage,
} from "ai";
import { MockLanguageModelV2 } from "ai/test";
import * as blink from "blink";
import { Client } from "blink/client";
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
    return core.streamStepResponse({
      model: options.model,
      messages,
      chatID: "b485db32-3d53-45fb-b980-6f4672fc66a6",
    });
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
