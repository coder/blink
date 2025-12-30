import { describe, expect, test } from "bun:test";
import { serve } from "../../../test";
import AgentInvocationClient from "./me.client";
import { generateAgentInvocationToken } from "./me.server";

describe("agent invocation api", async () => {
  let handleStartID: string | undefined;
  const { helpers, bindings, url } = await serve({
    bindings: {
      chat: {
        handleStart: async (opts) => {
          handleStartID = opts.id;
        },
      },
    },
  });
  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    description: "Test Description",
    organization_id: org.id,
  });

  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
      },
    ],
  });

  const target = await (
    await bindings.database()
  ).selectAgentDeploymentTargetByName(agent.id, "production");
  if (!target) {
    throw new Error("Target not found");
  }
  const token = await generateAgentInvocationToken(bindings.AUTH_SECRET, {
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    agent_deployment_target_id: target.id,
  });

  const agentClient = new AgentInvocationClient({
    baseURL: url.toString(),
    authToken: token,
  });

  test("storage", async () => {
    expect(await agentClient.getStorage("test")).toBeUndefined();

    await agentClient.setStorage("test", "Hello, world!");

    const resp = await agentClient.getStorage("test");
    expect(resp).toBe("Hello, world!");
  });

  test("upsert chat", async () => {
    // This should be idempotent.
    await agentClient.upsertChat("bananas");
    await agentClient.upsertChat("bananas");
    await agentClient.upsertChat("bananas");
    await agentClient.upsertChat("bananas");
    await agentClient.upsertChat("bananas");

    const chats = await client.chats.list({
      organization_id: org.id,
    });
    expect(chats.items.length).toBe(1);
  });

  test("send messages", async () => {
    const upserted = await agentClient.upsertChat("frogger");
    expect(handleStartID).toBeUndefined();
    await agentClient.sendMessages(upserted.id, {
      behavior: "interrupt",
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
    expect(handleStartID).toBeDefined();
  });

  test("get chat", async () => {
    const upserted = await agentClient.upsertChat("get-test");
    const retrieved = await agentClient.getChat(upserted.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(upserted.id);
    expect(retrieved?.createdAt).toBe(upserted.created_at);

    // Non-existent chat should return undefined
    const nonExistent = await agentClient.getChat(
      "00000000-0000-0000-0000-000000000000"
    );
    expect(nonExistent).toBeUndefined();
  });

  test("delete chat", async () => {
    const upserted = await agentClient.upsertChat("delete-test");
    const retrieved = await agentClient.getChat(upserted.id);
    expect(retrieved).toBeDefined();

    await agentClient.deleteChat(upserted.id);
    const afterDelete = await agentClient.getChat(upserted.id);
    expect(afterDelete).toBeUndefined();
  });

  test("start and stop chat", async () => {
    handleStartID = undefined;
    const upserted = await agentClient.upsertChat("start-stop-test");

    // Start the chat
    await agentClient.startChat(upserted.id);
    expect(handleStartID!).toBe(upserted.id);

    // Stop is a no-op in tests but should not throw
    await agentClient.stopChat(upserted.id);
  });

  test("get messages", async () => {
    const upserted = await agentClient.upsertChat("get-messages-test");

    // Initially empty
    const emptyMessages = await agentClient.getMessages(upserted.id);
    expect(emptyMessages.length).toBe(0);

    // Add messages
    await agentClient.sendMessages(upserted.id, {
      behavior: "append",
      messages: [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "Hello!",
            },
          ],
        },
        {
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Hi there!",
            },
          ],
        },
      ],
    });

    // Verify messages were added
    const messages = await agentClient.getMessages(upserted.id);
    expect(messages.length).toBe(2);

    // Find the user and assistant messages (order may vary)
    const userMessage = messages.find((m) => m.role === "user");
    const assistantMessage = messages.find((m) => m.role === "assistant");

    expect(userMessage).toBeDefined();
    expect(userMessage!.parts[0]).toEqual({
      type: "text",
      text: "Hello!",
    });
    expect(assistantMessage).toBeDefined();
  });

  test("delete messages", async () => {
    const upserted = await agentClient.upsertChat("delete-messages-test");

    // Add messages
    await agentClient.sendMessages(upserted.id, {
      behavior: "append",
      messages: [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "Message 1",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "Message 2",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "Message 3",
            },
          ],
        },
      ],
    });

    const messages = await agentClient.getMessages(upserted.id);
    expect(messages.length).toBe(3);

    // Delete the first message
    await agentClient.deleteMessages(upserted.id, [messages[0].id!]);

    const afterDelete = await agentClient.getMessages(upserted.id);
    expect(afterDelete.length).toBe(2);
    expect(afterDelete[0].id!).toBe(messages[1].id!);
  });
});
