import Client, { type Chat, type ChatMessage } from "@blink.so/api";
import { connectToPostgres } from "@blink.so/database/postgres";
import Querier from "@blink.so/database/querier";
import { createPostgresURL, createTestUser } from "@blink.so/database/test";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Miniflare } from "miniflare";
import { encode } from "next-auth/jwt";
import { compileWorker, createMiniflare } from "../test";

let miniflare: Miniflare;
let client: Client;
let querier: Querier;

beforeEach(async () => {
  // Start compiling while we wait for the database to be ready.
  compileWorker();

  const url = await createPostgresURL();
  querier = new Querier(await connectToPostgres(url));

  miniflare = await createMiniflare({
    bindings: {
      HYPERDRIVE: {
        connectionString: url,
      },
      AUTH_SECRET: "test",
      NODE_ENV: "development",
    },
    durableObjects: {
      CHAT: {
        className: "Chat",
      },
    },
  });

  // This is janky we should change this to use signup once we have that.
  const user = await createTestUser(querier);
  client = new Client({
    baseURL: (await miniflare.unsafeGetDirectURL()).toString(),
    authToken: await encode({
      secret: "test",
      salt: "blink_session_token",
      token: {
        sub: user.id,
      },
    }),
  });
});

afterEach(async () => {
  if (miniflare) {
    try {
      await miniflare.dispose();
    } catch (err) {}
  }
});

const setup = async ({
  agentFetch,
}: {
  agentFetch: (req: Request) => Promise<Response>;
}) => {
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    organization_id: org.id,
    name: "test-agent",
  });
  const url = createFakeAgent(agentFetch);
  const deploymentTarget = await querier.selectAgentDeploymentTargetByName(
    agent.id,
    "production"
  );
  if (!deploymentTarget) {
    throw new Error("Deployment target not found");
  }
  // Manually create a deployment for now until we have a local
  // API that can be used for development as well.
  const deployment = await querier.insertAgentDeployment({
    agent_id: agent.id,
    target_id: deploymentTarget.id,
    entrypoint: "index.js",
    created_from: "cli",
    platform: "lambda",
    compatibility_version: "3",
    platform_memory_mb: 256,
    platform_region: "us-east-1",
    direct_access_url: url,
  });
  await querier.updateAgent({
    id: agent.id,
    active_deployment_id: deployment.id,
  });
  return { org, agent, deployment };
};

test("chat updates with error", async () => {
  const { org, agent, deployment } = await setup({
    agentFetch: async (req) => {
      return new Response("Internal Server Error", { status: 500 });
    },
  });
  const created = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    stream: true,
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: "Hello, world!",
          },
        ],
      },
    ],
  });
  let chat: Chat | undefined;
  for await (const message of created.stream) {
    if (message.event === "chat.updated" && message.data.status === "error") {
      chat = message.data;
      break;
    }
  }
  if (!chat) {
    throw new Error("Chat not found");
  }
  expect(chat.status).toBe("error");
  expect(chat.error).toBe("Failed (500): Internal Server Error");
});

test("chat completes streaming", async () => {
  const { org, agent, deployment } = await setup({
    agentFetch: async () => {
      return createChunkResponse([
        {
          type: "text-start",
          id: "1",
        },
        {
          type: "text-delta",
          id: "1",
          delta: "Hello, world!",
        },
        {
          type: "text-end",
          id: "1",
        },
        {
          type: "message-metadata",
          messageMetadata: {
            model: "claude-sonnet-4-5-20250929",
            totalUsage: {
              inputTokens: 100,
              outputTokens: 100,
              totalTokens: 200,
              cachedInputTokens: 0,
            },
          },
        },
      ]);
    },
  });
  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    stream: true,
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: "Hello, world!",
          },
        ],
      },
    ],
  });
  let msg!: ChatMessage;
  for await (const message of chat.stream) {
    if (message.event === "message.created") {
      if (message.data.role !== "assistant") {
        continue;
      }
      msg = message.data;
      break;
    }
  }
  expect(msg).toBeDefined();

  // The message here should always be the same as from the API.
  const api = await client.messages.get(msg.id);
  expect(api).toEqual(msg);

  // Ensure the steps have the time to first token micros
  const steps = await client.chats.steps.list({
    chat_id: chat.id,
  });
  expect(steps.items.length).toBe(1);
  expect(steps.items[0]!.time_to_first_token_micros).toBeDefined();
  expect(steps.items[0]!.time_to_first_token_micros).toBeGreaterThan(0);

  const step = await client.chats.steps.get({
    chat_id: chat.id,
    step_id: steps.items[0]!.id,
  });

  expect(step.usage_model).toBe("claude-sonnet-4-5-20250929");
  expect(step.usage_total_input_tokens).toBe(100);
  expect(step.usage_total_output_tokens).toBe(100);
  expect(step.usage_total_tokens).toBe(200);
  expect(step.usage_total_cached_input_tokens).toBe(0);
});

const createChunkResponse = (chunks: UIMessageChunk[], keepOpen = false) => {
  const transform = new TransformStream();
  const writer = transform.writable.getWriter();
  (async () => {
    for (const chunk of chunks) {
      await writer.write(`data: ${JSON.stringify(chunk)}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
    }
    if (keepOpen) {
      return;
    }
    try {
      await writer.close();
    } catch {}
  })().catch((err) => {});
  return new Response(transform.readable, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
};

const createFakeAgent = (fn: (req: Request) => Promise<Response>): string => {
  const srv = Bun.serve({
    port: 0,
    fetch: async (req) => {
      return fn(req);
    },
  });
  return srv.url.toString();
};

test("enqueue twice rapidly creates a single run/step", async () => {
  let firstCall = true;
  // Stream a long response so the first run remains open while the second enqueue happens.
  const slowStream = () => {
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    (async () => {
      // Open a text part and keep it going for a bit
      await writer.write(
        `data: ${JSON.stringify({ type: "text-start", id: "1" })}\n\n`
      );
      for (let i = 0; i < 50; i++) {
        await writer.write(
          `data: ${JSON.stringify({ type: "text-delta", id: "1", delta: "x" })}\n\n`
        );
        await new Promise((r) => setTimeout(r, 5));
      }
      // Do not finish; we want it to still be streaming while assertions run.
      // The stream will be closed by server shutdown at test end.
    })().catch((err) => {});
    return new Response(transform.readable, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const { org, agent, deployment } = await setup({
    agentFetch: async () => {
      if (firstCall) {
        firstCall = false;
        return slowStream();
      }
      return slowStream();
    },
  });

  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
  });

  // Kick off first run
  await client.messages.send({
    chat_id: chat.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "Hello 1" }] }],
    behavior: "enqueue",
  });

  // Quickly enqueue again while the first run is still streaming
  await client.messages.send({
    chat_id: chat.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "Hello 2" }] }],
    behavior: "enqueue",
  });

  const runs = await client.chats.runs.list({ chat_id: chat.id });
  expect(runs.items.length).toBe(1);

  const steps = await client.chats.steps.list({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(steps.items.length).toBe(1);
  expect(["streaming", "stalled", "completed", "interrupted"]).toContain(
    steps.items[0]!.status
  );
});

test("interrupt mid-stream starts new run and marks previous interrupted", async () => {
  let callCount = 0;

  const quickCompletion = () =>
    createChunkResponse([
      { type: "text-start", id: "2" },
      { type: "text-delta", id: "2", delta: "done" },
      { type: "text-end", id: "2" },
    ]);

  const { org, agent, deployment } = await setup({
    agentFetch: async () => {
      callCount++;
      if (callCount === 1) {
        return createChunkResponse(
          [
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "a" },
          ],
          true
        );
      }
      return quickCompletion();
    },
  });

  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
  });

  // Start first streaming run
  const stream = await client.chats.stream(chat.id);
  const gotAChunk = (async () => {
    for await (const ev of stream) {
      if (ev.event === "message.chunk.added") {
        break;
      }
    }
  })();

  await client.messages.send({
    chat_id: chat.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "First" }] }],
    behavior: "enqueue",
  });

  // ensure streaming began
  await gotAChunk;

  // Now interrupt with a new message; this should abort the first and start a new run
  await client.messages.send({
    chat_id: chat.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "Second" }] }],
    behavior: "interrupt",
  });

  // Verify there are exactly two runs: first interrupted, latest streaming or completed
  const runs = await client.chats.runs.list({ chat_id: chat.id });
  expect(runs.items.length).toBe(2);
  const firstRunId = runs.items[1]!.id;
  // First run should be interrupted with the partial message ID
  const firstSteps = await client.chats.steps.list({
    chat_id: chat.id,
    run_id: firstRunId,
  });
  expect(firstSteps.items.length).toBe(1);
  expect(firstSteps.items[0]!.status).toBe("interrupted");

  const messages = await client.messages.list({
    chat_id: chat.id,
  });
  const responseMessageId = firstSteps.items[0]!.response_message_id!;
  expect(responseMessageId).toBeDefined();
  expect(messages.items.find((m) => m.id === responseMessageId)).toBeDefined();
});

test("loops on tool call", async () => {
  let callCount = 0;
  const { org, agent, deployment } = await setup({
    agentFetch: async () => {
      callCount++;
      if (callCount === 1) {
        return createChunkResponse([
          { type: "tool-input-start", toolCallId: "1", toolName: "test" },
          {
            type: "tool-input-delta",
            toolCallId: "1",
            inputTextDelta: '{"foo": "bar"}',
          },
          {
            type: "tool-input-available",
            toolCallId: "1",
            toolName: "test",
            input: '{"foo": "bar"}',
          },
          {
            type: "tool-output-available",
            toolCallId: "1",
            output: '{"foo": "bar"}',
          },
        ]);
      }
      return createChunkResponse([
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "looks like all is good" },
        { type: "text-end", id: "1" },
      ]);
    },
  });

  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
  });

  const stream = await client.chats.stream(chat.id);
  await client.messages.send({
    chat_id: chat.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
    behavior: "enqueue",
  });

  for await (const ev of stream) {
    if (ev.event === "chat.updated") {
      if (ev.data.status === "idle") {
        break;
      }
    }
  }

  const steps = await client.chats.steps.list({
    chat_id: chat.id,
  });
  expect(steps.items.length).toBe(2);
  expect(steps.items[0]!.status).toBe("completed");
  expect(steps.items[1]!.status).toBe("completed");
  expect(steps.items[0]!.response_message_id).toBeDefined();
  expect(steps.items[1]!.response_message_id).toBeDefined();
});

test("streaming buffer sends on reconnect", async () => {
  const { org, agent, deployment } = await setup({
    agentFetch: async () => {
      return createChunkResponse(
        [
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "Hello, world!" },
          { type: "text-end", id: "1" },
        ],
        true
      );
    },
  });

  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    stream: true,
    messages: [
      { role: "user", parts: [{ type: "text", text: "Hello, world!" }] },
    ],
  });

  let initialChunks = 0;
  for await (const msg of chat.stream) {
    if (msg.event === "message.chunk.added") {
      initialChunks++;
      if (msg.data.chunk.type === "text-end") {
        break;
      }
    }
  }

  // Test for both transport types.
  let stream = await client.chats.stream(chat.id, {
    transport: "websocket",
  });
  let wsReconnectChunks = 0;
  for await (const msg of stream) {
    if (msg.event === "message.chunk.added") {
      wsReconnectChunks++;
      if (msg.data.chunk.type === "text-end") {
        break;
      }
    }
  }
  expect(wsReconnectChunks).toBe(initialChunks);

  stream = await client.chats.stream(chat.id, {
    transport: "sse",
  });
  let sseReconnectChunks = 0;
  for await (const msg of stream) {
    if (msg.event === "message.chunk.added") {
      sseReconnectChunks++;
      if (msg.data.chunk.type === "text-end") {
        break;
      }
    }
  }
  expect(sseReconnectChunks).toBe(initialChunks);
});
