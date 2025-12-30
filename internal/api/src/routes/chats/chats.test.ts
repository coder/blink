import { expect, test } from "bun:test";
import Client from "../../client.node";
import { serve } from "../../test";

test("CRUD /api/chats", async () => {
  const { helpers, bindings } = await serve();
  const { client, user: owner } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });

  const agent = await client.agents.create({
    organization_id: org.id,
    name: "test-agent",
    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
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

  // Create a chat.
  let chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });
  const firstChat = chat;

  // List the chats.
  let list = await client.chats.list({
    organization_id: org.id,
    limit: 1,
  });
  expect(list.items.length).toBe(1);
  const { messages, ...rest } = chat;
  expect(list.items[0]).toEqual(rest);
  expect(list.next_cursor).toBeNull();

  // Create another chat.
  chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });
  list = await client.chats.list({
    organization_id: org.id,
    limit: 1,
  });
  expect(list.next_cursor).toBeString();
  expect(list.items.length).toBe(1);
  // It should equal the new chat, because we sort by created_at descending.
  const { messages: _, ...rest2 } = chat;
  expect(list.items[0]).toEqual(rest2);

  // Delete the new chat.
  await client.chats.delete(chat.id);

  // List the chats.
  list = await client.chats.list({
    organization_id: org.id,
    limit: 1,
  });
  expect(list.items.length).toBe(1);
  const { messages: __, ...rest3 } = firstChat;
  expect(list.items[0]).toEqual(rest3);
  expect(list.next_cursor).toBeNull();
});

test("create chat with messages", async () => {
  const { helpers, bindings } = await serve();
  const { client, user: owner } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });

  const agent = await client.agents.create({
    organization_id: org.id,
    name: "test-agent",
    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
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

  const messages = await client.messages.list({
    chat_id: chat.id,
  });
  expect(messages.items.length).toBe(1);

  // Since we created the chat with messages, it should immediately
  // start streaming.
  const runs = await client.chats.runs.list({
    chat_id: chat.id,
  });
  expect(runs.items.length).toBe(1);
  expect(runs.items[0]!.status).toBe("streaming");
});

test("agent owners can access chats from other orgs", async () => {
  const { helpers, bindings } = await serve();
  const { client: agentOwner } = await helpers.createUser();
  const { client: chatCreator, user: chatCreatorUser } =
    await helpers.createUser();

  // Agent owner creates their org and agent
  const ownerOrg = await agentOwner.organizations.create({
    name: "owner-org",
  });

  const agent = await agentOwner.agents.create({
    organization_id: ownerOrg.id,
    name: "test-agent",
    output_files: [
      {
        path: "test.js",
        data: "console.log('test');",
      },
    ],
  });

  const deployments = await agentOwner.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(1);
  await agentOwner.agents.update({
    id: agent.id,
    active_deployment_id: deployments.items[0]!.id,
  });

  // Chat creator has their own org and joins the agent's org
  const creatorOrg = await chatCreator.organizations.create({
    name: "creator-org",
  });

  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: ownerOrg.id,
    user_id: chatCreatorUser.id,
    role: "member",
  });

  // Chat creator creates a chat (belongs to their personal org)
  const chat = await chatCreator.chats.create({
    organization_id: creatorOrg.id,
    agent_id: agent.id,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "test message" }],
      },
    ],
  });

  // Agent owner should be able to access the chat
  const chatFromOwner = await agentOwner.chats.get(chat.id);
  expect(chatFromOwner.id).toBe(chat.id);

  // Agent owner should be able to access messages
  const messagesFromOwner = await agentOwner.messages.list({
    chat_id: chat.id,
  });
  expect(messagesFromOwner.items.length).toBeGreaterThan(0);

  // Chat creator can also access
  const chatFromCreator = await chatCreator.chats.get(chat.id);
  expect(chatFromCreator.id).toBe(chat.id);

  const messagesFromCreator = await chatCreator.messages.list({
    chat_id: chat.id,
  });
  expect(messagesFromCreator.items.length).toBeGreaterThan(0);
});

test("chat listing permissions - read user sees only own chats", async () => {
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

  // Create chats from different users
  const ownerChat = await ownerClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });

  const readChat = await readClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });

  const writeChat = await writeClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });

  // Read user should only see their own chat
  const readUserChats = await readClient.chats.list({
    agent_id: agent.id,
  });
  expect(readUserChats.items.length).toBe(1);
  expect(readUserChats.items[0]!.id).toBe(readChat.id);

  // Write user should see all chats
  const writeUserChats = await writeClient.chats.list({
    agent_id: agent.id,
  });
  expect(writeUserChats.items.length).toBe(3);
  const writeUserChatIds = writeUserChats.items.map((c) => c.id).sort();
  expect(writeUserChatIds).toEqual(
    [ownerChat.id, readChat.id, writeChat.id].sort()
  );

  // Owner should see all chats
  const ownerChats = await ownerClient.chats.list({
    agent_id: agent.id,
  });
  expect(ownerChats.items.length).toBe(3);
});

test("API key authentication - CRUD chats", async () => {
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

  const deployments = await apiKeyClient.agents.deployments.list({
    agent_id: agent.id,
  });
  expect(deployments.items.length).toBe(1);
  await apiKeyClient.agents.update({
    id: agent.id,
    active_deployment_id: deployments.items[0]!.id,
  });

  const chat = await apiKeyClient.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });
  expect(chat).toBeDefined();
  expect(chat.id).toBeString();
  expect(chat.organization_id).toBe(org.id);
  expect(chat.agent.id).toBe(agent.id);

  const chatsList = await apiKeyClient.chats.list({
    organization_id: org.id,
  });
  expect(chatsList.items.length).toBe(1);
  expect(chatsList.items[0]!.id).toBe(chat.id);

  const fetchedChat = await apiKeyClient.chats.get(chat.id);
  expect(fetchedChat.id).toBe(chat.id);
  expect(fetchedChat.organization_id).toBe(org.id);

  await apiKeyClient.chats.delete(chat.id);

  const chatsListAfterDelete = await apiKeyClient.chats.list({
    organization_id: org.id,
  });
  expect(chatsListAfterDelete.items.length).toBe(0);
});

test("API key authentication - expired key should fail", async () => {
  const { helpers, bindings, url } = await serve();
  const { client, user: owner } = await helpers.createUser();
  const db = await bindings.database();

  const org = await client.organizations.create({
    name: "test-org-expired",
  });

  const apiKey = await client.users.createApiKey({
    name: "Expired API Key",
    expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  // Try to use expired API key
  const apiKeyClient = new Client({
    baseURL: url.toString(),
    authToken: apiKey.key,
  });

  await expect(
    apiKeyClient.chats.list({
      organization_id: org.id,
    })
  ).rejects.toThrow("API key has expired");
});

test("API key authentication - revoked key should fail", async () => {
  const { helpers, bindings, url } = await serve();
  const { client, user: owner } = await helpers.createUser();
  const db = await bindings.database();

  const org = await client.organizations.create({
    name: "test-org-revoked",
  });

  const apiKey = await client.users.createApiKey({
    name: "Revoked API Key",
  });

  await db.updateApiKey(apiKey.id, {
    revoked_at: new Date(),
    revoked_by: owner.id,
  });

  // Try to use revoked API key
  const apiKeyClient = new Client({
    baseURL: url.toString(),
    authToken: apiKey.key,
  });

  await expect(
    apiKeyClient.chats.list({
      organization_id: org.id,
    })
  ).rejects.toThrow("API key not found");
});

test("API key authentication - invalid key should fail", async () => {
  const { url } = await serve();

  // Use a fake API key
  const apiKeyClient = new Client({
    baseURL: url.toString(),
    authToken: "bk_invalid_key_that_does_not_exist",
  });

  await expect(apiKeyClient.organizations.list()).rejects.toThrow(
    "API key not found"
  );
});
