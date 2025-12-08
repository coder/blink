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

  let resp = await client.agents.steps.list({
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    status: "completed",
  });
  expect(resp.items.length).toBe(0);

  resp = await client.agents.steps.list({
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    status: "streaming",
  });
  expect(resp.items.length).toBe(1);
  expect(resp.items[0]!.status).toBe("streaming");

  const step = await client.agents.steps.get({
    agent_id: agent.id,
    step_id: resp.items[0]!.id,
  });
  expect(step.status).toBe("streaming");
});

test("steps permissions - read user sees only own chat steps", async () => {
  const { helpers, bindings } = await serve();
  const { user: readUser, client: readClient } = await helpers.createUser();
  const { user: writeUser, client: writeClient } = await helpers.createUser();
  const { client: ownerClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({ name: "test-org" });
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
    output_files: [{ path: "test.js", data: "console.log('test');" }],
  });

  const deployments = await ownerClient.agents.deployments.list({
    agent_id: agent.id,
  });
  await ownerClient.agents.update({
    id: agent.id,
    active_deployment_id: deployments.items[0]!.id,
  });

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

  // Create chats with messages
  await ownerClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "owner" }] }],
  });
  const readChat = await readClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "read" }] }],
  });
  await writeClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
    messages: [{ role: "user", parts: [{ type: "text", text: "write" }] }],
  });

  // Read user should only see steps from their own chat
  const readUserSteps = await readClient.agents.steps.list({
    agent_id: agent.id,
  });
  expect(readUserSteps.items.length).toBe(1);
  expect(readUserSteps.items[0]!.chat_id).toBe(readChat.id);

  // Write user should see all steps
  const writeUserSteps = await writeClient.agents.steps.list({
    agent_id: agent.id,
  });
  expect(writeUserSteps.items.length).toBe(3);
});
