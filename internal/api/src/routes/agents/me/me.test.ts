import { describe, expect, test } from "bun:test";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "../../../server";
import { serve } from "../../../test";
import AgentInvocationClient from "./me.client";
import {
  generateAgentDeploymentToken,
  generateAgentInvocationToken,
  withAgentAuth,
  withAgentDeploymentAuth,
  withAgentInvocationAuth,
} from "./me.server";

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

// Helper to create a test app with a given middleware
const createTestApp = (
  middleware: MiddlewareHandler
): Hono<{ Bindings: Bindings }> => {
  const app = new Hono<{ Bindings: Bindings }>();
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ message: err.message }, err.status);
    }
    return c.json({ message: "Internal Server Error" }, 500);
  });
  app.get("/test", middleware, (c) => {
    // Use type assertion since context variables are set by middleware
    const ctx = c as unknown as {
      get: (key: string) => string | undefined;
    };
    return c.json({
      agent_id: ctx.get("agent_id"),
      agent_deployment_id: ctx.get("agent_deployment_id"),
      agent_deployment_target_id: ctx.get("agent_deployment_target_id"),
      run_id: ctx.get("run_id"),
      step_id: ctx.get("step_id"),
      chat_id: ctx.get("chat_id"),
      auth_type: ctx.get("auth_type"),
    });
  });
  return app;
};

describe("withAgentInvocationAuth", () => {
  // Invocation auth doesn't validate against DB, so we can use random IDs
  test("should authenticate with valid invocation token", async () => {
    const { bindings } = await serve();

    const token = await generateAgentInvocationToken(bindings.AUTH_SECRET, {
      agent_id: crypto.randomUUID(),
      agent_deployment_id: crypto.randomUUID(),
      agent_deployment_target_id: crypto.randomUUID(),
      run_id: "run-123",
      step_id: "step-456",
      chat_id: "chat-789",
    });

    const app = createTestApp(withAgentInvocationAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run_id).toBe("run-123");
    expect(body.step_id).toBe("step-456");
    expect(body.chat_id).toBe("chat-789");
  });

  test("should reject missing Authorization header", async () => {
    const { bindings } = await serve();

    const app = createTestApp(withAgentInvocationAuth);
    const response = await app.request("/test", {}, bindings);

    expect(response.status).toBe(401);
  });

  test("should reject invalid token", async () => {
    const { bindings } = await serve();

    const app = createTestApp(withAgentInvocationAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: "Bearer invalid-token" } },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject token with wrong salt (deployment token)", async () => {
    const { bindings } = await serve();

    const deploymentToken = await generateAgentDeploymentToken(
      bindings.AUTH_SECRET,
      {
        agent_id: crypto.randomUUID(),
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
      }
    );

    const app = createTestApp(withAgentInvocationAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${deploymentToken}` } },
      bindings
    );

    expect(response.status).toBe(401);
  });
});

// Helper to create agent with deployment for DB-validating auth tests
async function createAgentWithDeployment() {
  const { bindings, helpers } = await serve();
  const { client } = await helpers.createUser();
  const db = await bindings.database();

  const org = await client.organizations.create({ name: "test-org" });
  const agent = await client.agents.create({
    name: "test-agent",
    description: "Test",
    organization_id: org.id,
  });
  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    output_files: [{ path: "test.js", data: "console.log('test');" }],
  });
  const target = await db.selectAgentDeploymentTargetByName(
    agent.id,
    "production"
  );
  if (!target) throw new Error("Target not found");

  return { bindings, agent, deployment, target };
}

describe("withAgentDeploymentAuth", () => {
  // Deployment auth validates against DB, so we need real records
  test("should authenticate with valid deployment token", async () => {
    const { bindings, agent, deployment, target } =
      await createAgentWithDeployment();

    const token = await generateAgentDeploymentToken(bindings.AUTH_SECRET, {
      agent_id: agent.id,
      agent_deployment_id: deployment.id,
      agent_deployment_target_id: target.id,
    });

    const app = createTestApp(withAgentDeploymentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agent_id).toBe(agent.id);
    expect(body.agent_deployment_id).toBe(deployment.id);
    expect(body.agent_deployment_target_id).toBe(target.id);
  });

  test("should reject missing Authorization header", async () => {
    const { bindings } = await serve();

    const app = createTestApp(withAgentDeploymentAuth);
    const response = await app.request("/test", {}, bindings);

    expect(response.status).toBe(401);
  });

  test("should reject invalid token", async () => {
    const { bindings } = await serve();

    const app = createTestApp(withAgentDeploymentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: "Bearer invalid-token" } },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject token with wrong salt (invocation token)", async () => {
    const { bindings } = await serve();

    const invocationToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: crypto.randomUUID(),
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
      }
    );

    const app = createTestApp(withAgentDeploymentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${invocationToken}` } },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject token with non-existent deployment", async () => {
    const { bindings, agent, target } = await createAgentWithDeployment();

    const token = await generateAgentDeploymentToken(bindings.AUTH_SECRET, {
      agent_id: agent.id,
      agent_deployment_id: crypto.randomUUID(), // non-existent
      agent_deployment_target_id: target.id,
    });

    const app = createTestApp(withAgentDeploymentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject token with mismatched agent_id", async () => {
    const { bindings, deployment, target } = await createAgentWithDeployment();

    const token = await generateAgentDeploymentToken(bindings.AUTH_SECRET, {
      agent_id: crypto.randomUUID(), // mismatched
      agent_deployment_id: deployment.id,
      agent_deployment_target_id: target.id,
    });

    const app = createTestApp(withAgentDeploymentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(401);
  });
});

describe("withAgentAuth", () => {
  test("should authenticate with invocation token and set auth_type", async () => {
    const { bindings } = await serve();

    const token = await generateAgentInvocationToken(bindings.AUTH_SECRET, {
      agent_id: crypto.randomUUID(),
      agent_deployment_id: crypto.randomUUID(),
      agent_deployment_target_id: crypto.randomUUID(),
      run_id: "run-abc",
    });

    const app = createTestApp(withAgentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.auth_type).toBe("invocation");
    expect(body.run_id).toBe("run-abc");
  });

  test("should authenticate with deployment token and set auth_type", async () => {
    const { bindings, agent, deployment, target } =
      await createAgentWithDeployment();

    const token = await generateAgentDeploymentToken(bindings.AUTH_SECRET, {
      agent_id: agent.id,
      agent_deployment_id: deployment.id,
      agent_deployment_target_id: target.id,
    });

    const app = createTestApp(withAgentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.auth_type).toBe("deployment");
    expect(body.agent_id).toBe(agent.id);
  });

  test("should reject missing Authorization header", async () => {
    const { bindings } = await serve();

    const app = createTestApp(withAgentAuth);
    const response = await app.request("/test", {}, bindings);

    expect(response.status).toBe(401);
  });

  test("should reject invalid token", async () => {
    const { bindings } = await serve();

    const app = createTestApp(withAgentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: "Bearer invalid-token" } },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject deployment token with invalid DB state", async () => {
    const { bindings } = await serve();

    // Token with random IDs - invocation decode will fail (wrong salt),
    // deployment decode will succeed but DB validation will fail
    const token = await generateAgentDeploymentToken(bindings.AUTH_SECRET, {
      agent_id: crypto.randomUUID(),
      agent_deployment_id: crypto.randomUUID(),
      agent_deployment_target_id: crypto.randomUUID(),
    });

    const app = createTestApp(withAgentAuth);
    const response = await app.request(
      "/test",
      { headers: { Authorization: `Bearer ${token}` } },
      bindings
    );

    expect(response.status).toBe(401);
  });
});
