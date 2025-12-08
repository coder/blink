import { expect, test } from "bun:test";
import { serve } from "../../test";

test("GET /api/organizations/:organization_id/agents/:agent_name", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create an organization.
  const org = await client.organizations.create({
    name: "test-org",
  });

  // Create an agent.
  const createdAgent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  // Get the agent.
  const agent = await client.organizations.agents.get({
    organization_id: org.id,
    agent_name: createdAgent.name,
  });

  // Both should have the same core properties
  expect(createdAgent.id).toEqual(agent.id);
  expect(createdAgent.name).toEqual(agent.name);
  expect(createdAgent.organization_id).toEqual(agent.organization_id);
  expect(createdAgent.user_permission).toEqual("admin");
  expect(agent.user_permission).toEqual("admin");
});
