import { expect, test } from "bun:test";
import { serve } from "../../test";

test("GET /api/chats/:chat_id/steps", async () => {
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
  const run = runs.items[0]!;

  const resp = await client.chats.steps.list({
    chat_id: chat.id,
    run_id: run.id,
  });
  expect(resp.items.length).toBe(1);
  expect(resp.items[0]!.status).toBe("streaming");

  const step = await client.chats.steps.get({
    chat_id: chat.id,
    step_id: resp.items[0]!.id,
  });
  expect(step.status).toBe("streaming");
});
