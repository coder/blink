import { expect, test } from "bun:test";
import { serve } from "../../test";

test("CRUD /api/agents/:id/env", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    description: "Test Description",
    visibility: "public",
    organization_id: org.id,

    env: [
      {
        key: "TEST_ENV",
        value: "test",
        secret: false,
      },
    ],
  });

  let vars = await client.agents.env.list({
    agent_id: agent.id,
  });
  expect(vars.length).toBe(1);
  let envVar = vars[0]!;
  expect(envVar.key).toBe("TEST_ENV");
  expect(envVar.value).toBe("test");
  expect(envVar.secret).toBe(false);
  // By default, it's for all environments.
  expect(envVar.target).toEqual(["preview", "production"]);

  // Update the environment variable to remove it from preview.
  const updated = await client.agents.env.update({
    agent_id: agent.id,
    id: envVar.id,
    value: "another",
    target: ["preview", "production"],
  });
  expect(updated.value).toBe("another");
  expect(updated.target).toEqual(["preview", "production"]);

  // Try creating a new environment variable with the same key. By default, it's for all environments.
  await expect(
    client.agents.env.create({
      agent_id: agent.id,
      key: "TEST_ENV",
      value: "something",
      secret: false,
      target: ["production"],
    })
  ).rejects.toThrow("already exists for your provided target(s)");

  vars = await client.agents.env.list({
    agent_id: agent.id,
  });
  expect(vars.length).toBe(1);
  envVar = vars[0]!;

  await client.agents.env.delete({
    agent_id: agent.id,
    id: envVar.id,
  });

  vars = await client.agents.env.list({
    agent_id: agent.id,
  });
  expect(vars.length).toBe(0);

  // Ensure upserting works.
  let upserted = await client.agents.env.create({
    agent_id: agent.id,
    key: "TEST_ENV",
    value: "something",
    secret: false,
    target: ["production"],
    upsert: true,
  });
  expect(upserted.value).toBe("something");
  expect(upserted.target).toEqual(["production"]);

  upserted = await client.agents.env.create({
    agent_id: agent.id,
    key: "TEST_ENV",
    value: "new-value",
    secret: false,
    target: ["production"],
    upsert: true,
  });
  expect(upserted.value).toBe("new-value");
});
