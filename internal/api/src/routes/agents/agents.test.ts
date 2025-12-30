import { expect, test } from "bun:test";
import { serve } from "../../test";

test("CRUD /api/agents", async () => {
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
  });

  let agents = await client.agents.list({
    organization_id: org.id,
  });
  expect(agents.items.length).toBe(1);
  expect(agents.items[0]).toEqual(agent);

  await client.agents.delete(agent.id);

  agents = await client.agents.list({
    organization_id: org.id,
  });
  expect(agents.items.length).toBe(0);
});

test("create agent with deployment and env", async () => {
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

    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
      },
    ],

    env: [
      {
        key: "TEST_ENV",
        value: "test",
        secret: false,
      },
    ],
  });

  const deployments = await client.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(1);
  const deployment = deployments.items[0]!;
  expect(deployment.output_files.length).toBe(1);
  expect(deployment.output_files[0]!.path).toBe("test.js");
  expect(deployment.output_files[0]!.id).toBeDefined();
  expect(deployment.target).toBe("production");

  const vars = await client.agents.env.list({
    agent_id: agent.id,
  });
  expect(vars.length).toBe(1);
  expect(vars[0]!.key).toBe("TEST_ENV");
  expect(vars[0]!.value).toBe("test");
  expect(vars[0]!.secret).toBe(false);
  // By default, it's for all environments.
  expect(vars[0]!.target).toEqual(["preview", "production"]);
});

test("create and update agent with duplicate name", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  await expect(
    client.agents.create({
      name: "test-AGENT",
      organization_id: org.id,
    })
  ).rejects.toThrow("That name is already taken!");

  const second = await client.agents.create({
    name: "test-agent-2",
    organization_id: org.id,
  });

  await expect(
    client.agents.update({
      id: second.id,
      name: "test-agent",
    })
  ).rejects.toThrow("That name is already taken!");
});

test("get agent runtime usage", async () => {
  const { helpers } = await serve({
    bindings: {
      runtime: {
        usage: async () => "10.0",
      },
    },
  });
  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  const startTime = new Date("2025-01-01T00:00:00Z");
  const endTime = new Date("2025-01-02T00:00:00Z");

  const usage = await client.agents.getRuntimeUsage({
    agent_id: agent.id,
    start_time: startTime,
    end_time: endTime,
  });

  expect(usage.seconds).toBe("10.0");
});

test("agent permissions - read user can view but not modify", async () => {
  const { helpers, bindings } = await serve();
  const { user: ownerUser, client: ownerClient } = await helpers.createUser();
  const { user: readUser, client: readClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({
    name: "test-org",
  });

  // Add read user to organization
  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: readUser.id,
    role: "member",
  });

  // Create a private agent
  const agent = await ownerClient.agents.create({
    name: "test-agent",
    description: "Test Description",
    visibility: "private",
    organization_id: org.id,
  });

  // Grant read permission
  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: readUser.id,
    permission: "read",
  });

  // Read user can get agent
  const fetchedAgent = await readClient.agents.get(agent.id);
  expect(fetchedAgent.id).toBe(agent.id);

  // Read user cannot update agent
  await expect(
    readClient.agents.update({
      id: agent.id,
      description: "Modified",
    })
  ).rejects.toThrow("write permission");

  // Read user cannot change visibility
  await expect(
    readClient.agents.update({
      id: agent.id,
      visibility: "public",
    })
  ).rejects.toThrow("write permission");

  // Read user cannot delete agent
  await expect(readClient.agents.delete(agent.id)).rejects.toThrow(
    "admin permission"
  );

  // Read user cannot manage members
  await expect(
    readClient.agents.members.grant({
      agent_id: agent.id,
      user_id: readUser.id,
      permission: "write",
    })
  ).rejects.toThrow("admin permission");
});

test("agent permissions - write user can modify but not delete", async () => {
  const { helpers, bindings } = await serve();
  const { user: ownerUser, client: ownerClient } = await helpers.createUser();
  const { user: writeUser, client: writeClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({
    name: "test-org",
  });

  // Add write user to organization
  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: writeUser.id,
    role: "member",
  });

  const agent = await ownerClient.agents.create({
    name: "test-agent",
    description: "Test Description",
    visibility: "private",
    organization_id: org.id,
  });

  // Grant write permission
  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: writeUser.id,
    permission: "write",
  });

  // Write user can update agent
  const updated = await writeClient.agents.update({
    id: agent.id,
    description: "Modified Description",
  });
  expect(updated.description).toBe("Modified Description");

  // Write user cannot change visibility (requires admin)
  await expect(
    writeClient.agents.update({
      id: agent.id,
      visibility: "public",
    })
  ).rejects.toThrow("admin permission");

  // Write user cannot delete agent
  await expect(writeClient.agents.delete(agent.id)).rejects.toThrow(
    "admin permission"
  );

  // Write user cannot manage members
  await expect(
    writeClient.agents.members.grant({
      agent_id: agent.id,
      user_id: writeUser.id,
      permission: "admin",
    })
  ).rejects.toThrow("admin permission");
});

test("agent permissions - admin can do everything including change visibility", async () => {
  const { helpers, bindings } = await serve();
  const { user: ownerUser, client: ownerClient } = await helpers.createUser();
  const { user: adminUser, client: adminClient } = await helpers.createUser();
  const { user: newMemberUser, client: newMember } = await helpers.createUser();

  const org = await ownerClient.organizations.create({
    name: "test-org",
  });

  // Add admin user to organization
  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: adminUser.id,
    role: "member",
  });

  const agent = await ownerClient.agents.create({
    name: "test-agent",
    visibility: "private",
    organization_id: org.id,
  });

  // Grant admin permission
  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: adminUser.id,
    permission: "admin",
  });

  // Admin can update agent
  await adminClient.agents.update({
    id: agent.id,
    description: "Updated by admin",
  });

  // Admin can change visibility
  const updated = await adminClient.agents.update({
    id: agent.id,
    visibility: "public",
  });
  expect(updated.visibility).toBe("public");

  // Admin can manage members
  await adminClient.agents.members.grant({
    agent_id: agent.id,
    user_id: newMemberUser.id,
    permission: "read",
  });

  const members = await adminClient.agents.members.list({ agent_id: agent.id });
  expect(members.items.length).toBe(3); // owner + admin + new member

  // Admin can delete agent
  await adminClient.agents.delete(agent.id);
});

test("agent permissions - no access to private agent without permission", async () => {
  const { helpers, bindings } = await serve();
  const { user: ownerUser, client: ownerClient } = await helpers.createUser();
  const { user: otherUser, client: otherClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({
    name: "test-org",
  });

  // Add other user to the organization so they can attempt to access the agent
  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: otherUser.id,
    role: "member",
  });

  const agent = await ownerClient.agents.create({
    name: "test-agent",
    visibility: "private",
    organization_id: org.id,
  });

  // Other user cannot access private agent without explicit permission
  await expect(otherClient.agents.get(agent.id)).rejects.toThrow(
    "private agent requires explicit permission"
  );
});
