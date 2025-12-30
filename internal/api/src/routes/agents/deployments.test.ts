import { expect, test } from "bun:test";
import Client from "../../client.node";
import { serve } from "../../test";

test("CRUD /api/agents/:agent_id/deployments", async () => {
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

  const file = await client.files.upload(
    new File(["console.log('Hello, world!');"], "test.js")
  );

  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    output_files: [
      {
        path: "test.js",
        id: file.id,
      },
    ],
  });
  expect(deployment.number).toBe(1);
  expect(deployment.status).toBe("pending");

  const deployments = await client.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(1);
  expect(deployments.items[0]).toEqual(deployment);
});

test("Backwards compatibility: /api/agents/:agent_id/deployments with legacy 'files' field", async () => {
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

  const file = await client.files.upload(
    new File(["console.log('Hello, world!');"], "test.js")
  );

  // Use legacy 'files' field instead of 'output_files'
  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    files: [
      {
        path: "test.js",
        id: file.id,
      },
    ],
  } as any); // Cast to any to bypass TypeScript check for legacy field

  expect(deployment.number).toBe(1);
  expect(deployment.status).toBe("pending");
  // Verify the files were properly mapped to output_files
  expect(deployment.output_files.length).toBe(1);
  expect(deployment.output_files[0].path).toBe("test.js");
});

test("Reject deployment when output files exceed 25MB", async () => {
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

  // Create a file that's 20MB
  const largeContent = new Uint8Array(20 * 1024 * 1024);
  const file1 = await client.files.upload(
    new File([largeContent], "large1.bin")
  );

  // Create another file that's 10MB (total 30MB)
  const mediumContent = new Uint8Array(10 * 1024 * 1024);
  const file2 = await client.files.upload(
    new File([mediumContent], "large2.bin")
  );

  // Should throw error because total size exceeds 25MB
  await expect(
    client.agents.deployments.create({
      agent_id: agent.id,
      target: "production",
      output_files: [
        {
          path: "large1.bin",
          id: file1.id,
        },
        {
          path: "large2.bin",
          id: file2.id,
        },
      ],
    })
  ).rejects.toThrow();
});

test("Accept deployment when output files are under 25MB", async () => {
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

  // Create two files that together are under 25MB
  const content1 = new Uint8Array(10 * 1024 * 1024); // 10MB
  const file1 = await client.files.upload(new File([content1], "medium1.bin"));

  const content2 = new Uint8Array(14 * 1024 * 1024); // 14MB (total 24MB)
  const file2 = await client.files.upload(new File([content2], "medium2.bin"));

  // Should succeed because total is under 25MB
  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    output_files: [
      {
        path: "medium1.bin",
        id: file1.id,
      },
      {
        path: "medium2.bin",
        id: file2.id,
      },
    ],
  });

  expect(deployment.number).toBe(1);
  expect(deployment.status).toBe("pending");
  expect(deployment.output_files.length).toBe(2);
});

test("deployments permissions - read user can view deployments", async () => {
  const { helpers, bindings } = await serve();
  const { user: readUser, client: readClient } = await helpers.createUser();
  const { client: ownerClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({ name: "test-org" });
  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: readUser.id,
    role: "member",
  });

  const agent = await ownerClient.agents.create({
    organization_id: org.id,
    name: "test-agent",
    visibility: "private",
    output_files: [{ path: "test.js", data: "console.log('test');" }],
  });

  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: readUser.id,
    permission: "read",
  });

  // Read user can list deployments
  const deployments = await readClient.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(1);

  // Read user can get deployment details
  const deployment = await readClient.agents.deployments.get({
    agent_id: agent.id,
    deployment_id: deployments.items[0]!.id,
  });
  expect(deployment.id).toBe(deployments.items[0]!.id);

  // Read user cannot create deployments
  await expect(
    readClient.agents.deployments.create({
      agent_id: agent.id,
      target: "production",
      output_files: [{ path: "new.js", data: "console.log('new');" }],
    })
  ).rejects.toThrow("write permission");
});

test("API key authentication - create deployment", async () => {
  const { helpers, bindings, url } = await serve();
  const { client, user: owner } = await helpers.createUser();
  const db = await bindings.database();

  const org = await client.organizations.create({
    name: "test-org-api-key",
  });
  const apiKey = await client.users.createApiKey({
    name: "Test API Key",
  });
  const apiKeyClient = new Client({
    baseURL: url.toString(),
    authToken: apiKey.key,
  });

  const agent = await apiKeyClient.agents.create({
    organization_id: org.id,
    name: "test-agent-api-key",
    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello from API key!');",
      },
    ],
  });

  const deployment = await apiKeyClient.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    output_files: [
      {
        path: "deploy.js",
        data: "console.log('Deployment from API key');",
      },
    ],
  });

  expect(deployment).toBeDefined();
  expect(deployment.number).toBe(2);
  expect(deployment.status).toBe("pending");
  expect(deployment.output_files.length).toBe(1);
  expect(deployment.output_files[0].path).toBe("deploy.js");

  const deployments = await apiKeyClient.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(2);
  expect(deployments.items.some((d) => d.id === deployment.id)).toBe(true);

  const fetchedDeployment = await apiKeyClient.agents.deployments.get({
    agent_id: agent.id,
    deployment_id: deployment.id,
  });
  expect(fetchedDeployment.id).toBe(deployment.id);
  expect(fetchedDeployment.number).toBe(2);
});
