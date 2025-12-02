import { expect, test } from "bun:test";
import { serve } from "../../test";

test("GET /api/chats/:chat_id/runs", async () => {
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

  const runs = await client.chats.runs.list({
    chat_id: chat.id,
  });
  expect(runs.items.length).toBe(1);

  let run = await client.chats.runs.get({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(run.agent_id).toBe(agent.id);
  expect(run.agent_deployment_id).toBe(deployment.id);
  expect(run.status).toBe("streaming");

  const db = await bindings.database();

  run = await client.chats.runs.get({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(run.status).toBe("streaming");

  const steps = await client.chats.steps.list({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(steps.items.length).toBe(1);
  const step = steps.items[0]!;

  await db.updateChatRunStep({
    id: step.id,
    error: "Test error",
  });

  run = await client.chats.runs.get({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(run.status).toBe("error");
  expect(run.error).toBe("Test error");

  await db.updateChatRunStep({
    id: step.id,
    error: null,
    completed_at: new Date(),
  });

  run = await client.chats.runs.get({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(run.status).toBe("completed");
  expect(run.error).toBe(null);
  expect(run.step_count).toBe(1);

  await db.insertChatRunStep({
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    chat_id: chat.id,
    chat_run_id: runs.items[0]!.id,
  });

  run = await client.chats.runs.get({
    chat_id: chat.id,
    run_id: runs.items[0]!.id,
  });
  expect(run.step_count).toBe(2);
  expect(run.status).toBe("streaming");
});
