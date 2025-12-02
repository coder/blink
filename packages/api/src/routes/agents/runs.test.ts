import { expect, test } from "bun:test";
import { serve } from "../../test";

test("GET /api/agents/:agent_id/runs", async () => {
  const { bindings, helpers } = await serve();
  const { client } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });

  const agent = await client.agents.create({
    organization_id: org.id,
    name: "test-agent",

    output_files: [
      {
        data: "console.log('Hello, world!');",
        path: "test.js",
      },
    ],
  });

  const deployments = await client.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(1);
  const deployment = deployments.items[0]!;
  await client.agents.update({
    id: agent.id,
    active_deployment_id: deployment.id,
  });

  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
  });

  await client.messages.send({
    chat_id: chat.id,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "Hello, world!" }],
      },
    ],
  });

  const runs = await client.agents.runs.list({
    agent_id: agent.id,
  });
  expect(runs.items.length).toBe(1);
  let run = runs.items[0]!;
  expect(run.agent_id).toBe(agent.id);
  expect(run.agent_deployment_id).toBe(deployment.id);
  // Users will rarely encounter a null status, but it's
  // possible when a run is created but not yet started.
  expect(run.status).toBe("streaming");

  const db = await bindings.database();
  run = await client.agents.runs.get({
    agent_id: agent.id,
    run_id: run.id,
  });
  expect(run.status).toBe("streaming");

  const steps = await client.agents.steps.list({
    agent_id: agent.id,
    run_id: run.id,
  });
  expect(steps.items.length).toBe(1);
  const step = steps.items[0]!;

  await db.updateChatRunStep({
    id: step.id,
    error: "Test error",
  });

  run = await client.agents.runs.get({
    agent_id: agent.id,
    run_id: run.id,
  });
  expect(run.status).toBe("error");
  expect(run.error).toBe("Test error");

  await db.updateChatRunStep({
    id: step.id,
    error: null,
    completed_at: new Date(),
  });

  run = await client.agents.runs.get({
    agent_id: agent.id,
    run_id: run.id,
  });
  expect(run.status).toBe("completed");
  expect(run.error).toBe(null);
  expect(run.step_count).toBe(1);

  await db.insertChatRunStep({
    agent_id: run.agent_id,
    agent_deployment_id: run.agent_deployment_id!,
    chat_id: chat.id,
    chat_run_id: run.id,
  });

  run = await client.agents.runs.get({
    agent_id: agent.id,
    run_id: run.id,
  });
  expect(run.step_count).toBe(2);
  expect(run.status).toBe("streaming");
});

test("runs permissions - read user sees only own chat runs", async () => {
  const { helpers, bindings } = await serve();
  const { user: ownerUser, client: ownerClient } = await helpers.createUser();
  const { user: readUser, client: readClient } = await helpers.createUser();
  const { user: writeUser, client: writeClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({
    name: "test-org",
  });

  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: readUser.id,
    role: "member",
  });
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: writeUser.id,
    role: "member",
  });

  const agent = await ownerClient.agents.create({
    organization_id: org.id,
    name: "test-agent",
    visibility: "private",
    output_files: [
      {
        path: "test.js",
        data: "console.log('test');",
      },
    ],
  });

  const deployments = await ownerClient.agents.deployments.list({
    agent_id: agent.id,
  });
  await ownerClient.agents.update({
    id: agent.id,
    active_deployment_id: deployments.items[0]!.id,
  });

  // Grant permissions
  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: readUser.id,
    permission: "read",
  });
  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: writeUser.id,
    permission: "write",
  });

  // Create chats with messages to trigger runs
  const ownerChat = await ownerClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "owner message" }],
      },
    ],
  });

  const readChat = await readClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "read message" }],
      },
    ],
  });

  const writeChat = await writeClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "write message" }],
      },
    ],
  });

  // Read user should only see runs from their own chat
  const readUserRuns = await readClient.agents.runs.list({
    agent_id: agent.id,
  });
  expect(readUserRuns.items.length).toBe(1);
  expect(readUserRuns.items[0]!.chat_id).toBe(readChat.id);

  // Write user should see all runs
  const writeUserRuns = await writeClient.agents.runs.list({
    agent_id: agent.id,
  });
  expect(writeUserRuns.items.length).toBe(3);
  const writeUserChatIds = writeUserRuns.items.map((r) => r.chat_id).sort();
  expect(writeUserChatIds).toEqual(
    [ownerChat.id, readChat.id, writeChat.id].sort()
  );

  // Owner should see all runs
  const ownerRuns = await ownerClient.agents.runs.list({
    agent_id: agent.id,
  });
  expect(ownerRuns.items.length).toBe(3);
});
