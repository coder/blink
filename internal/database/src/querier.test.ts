import { beforeEach, describe, expect, test } from "bun:test";
import connectToPostgres from "./postgres";
import Querier from "./querier";
import { type ChatRunStepStatus } from "./schema";
import {
  createPostgresURL,
  createTestAgent,
  createTestAgentDeployment,
  createTestChat,
  createTestOrganization,
  createTestUser,
} from "./test";

describe("updateOrganizationInviteLastAcceptedAtByID", () => {
  let querier: Querier;

  beforeEach(async () => {
    const url = await createPostgresURL();
    querier = new Querier(await connectToPostgres(url));
  });

  test("updates last_accepted_at for valid invite", async () => {
    // Create a team and invite
    const user = await createTestUser(querier);
    const team = await createTestOrganization(querier, { created_by: user.id });

    const invite = await querier.insertOrganizationInvite({
      organization_id: team.id,
      invited_by: user.id,
      email: "test@test.com",
      role: "member",
      reusable: true,
    });

    // Verify invite was created without last_accepted_at
    expect(invite.last_accepted_at).toBeNull();

    // Update the last_accepted_at
    const beforeUpdate = Date.now();
    await querier.updateOrganizationInviteLastAcceptedAtByID(invite.id);
    const afterUpdate = Date.now();

    // Verify the update using selectOrganizationInviteWithOrganizationByToken
    const inviteWithTeam =
      await querier.selectOrganizationInviteWithOrganizationByToken(
        invite.code
      );
    expect(inviteWithTeam).not.toBeNull();
    expect(inviteWithTeam!.organization_invite.last_accepted_at).not.toBeNull();

    const acceptedTime =
      inviteWithTeam!.organization_invite.last_accepted_at!.getTime();
    expect(acceptedTime).toBeGreaterThanOrEqual(beforeUpdate);
    expect(acceptedTime).toBeLessThanOrEqual(afterUpdate);
  });
});

test("cursor pagination", async () => {
  const url = await createPostgresURL();
  const querier = new Querier(await connectToPostgres(url));

  const user = await createTestUser(querier);
  const org = await createTestOrganization(querier, { created_by: user.id });
  const agent = await createTestAgent(querier, {
    created_by: user.id,
    organization_id: org.id,
  });

  for (let i = 0; i < 100; i++) {
    await createTestChat(querier, {
      created_by: user.id,
      organization_id: org.id,
      agent_id: agent.id,
    });
  }

  const limit = 10;

  // Page 1 (initial)
  const first = await querier.selectChats({
    organizationID: org.id,
    limit,
  });

  expect(first.items.length).toBe(limit);
  expect(first.next_cursor).toBeString();

  const firstIds = first.items.map((c) => c.id);

  // Page 2 (forward) using starting_after
  const second = await querier.selectChats({
    organizationID: org.id,
    cursor: first.next_cursor!,
    limit,
  });

  expect(second.items.length).toBe(limit);
  expect(second.next_cursor).toBeString();

  const secondIds = second.items.map((c) => c.id);
  // No overlap between consecutive pages when moving forward
  expect(firstIds.some((id) => secondIds.includes(id))).toBeFalse();

  // Walk to the end using starting_after and ensure we see all items without duplicates
  const seen = new Set<string>(firstIds);
  let cursor: string | undefined = first.next_cursor!;
  let pagesTraversed = 1; // already have first page
  // Iterate until no more pages
  // Safety cap to avoid infinite loop in case of logic bugs
  for (let i = 0; i < 20; i++) {
    const page = await querier.selectChats({
      organizationID: org.id,
      cursor,
      limit,
    });
    pagesTraversed++;

    for (const row of page.items) {
      expect(seen.has(row.id)).toBeFalse();
      seen.add(row.id);
    }

    if (!page.next_cursor) {
      // Last page specifics
      expect(page.next_cursor ?? null).toBeNull();
      expect(page.items.length).toBeLessThanOrEqual(limit);
      break;
    }

    expect(page.next_cursor).toBeString();
    cursor = page.next_cursor;
  }

  // We created exactly 100 chats; ensure we've paged through all of them
  expect(seen.size).toBe(100);
  // With limit 10 and 100 items, we should have traversed exactly 10 pages
  expect(pagesTraversed).toBe(10);

  // Single-page behavior (limit >= total): request a very large page size
  const bigPage = await querier.selectChats({
    organizationID: org.id,
    limit: 200,
  });
  expect(bigPage.items.length).toBe(100);
  expect(bigPage.next_cursor).toBeNull();
});

const prepareChatStatusTest = async () => {
  const db = await connectToPostgres(await createPostgresURL());
  const querier = new Querier(db);

  const user = await createTestUser(querier);
  const org = await createTestOrganization(querier, { created_by: user.id });
  const agent = await createTestAgent(querier, {
    created_by: user.id,
    organization_id: org.id,
  });
  const deployment = await createTestAgentDeployment(querier, {
    agent_id: agent.id,
    created_by: user.id,
  });
  await querier.updateAgent({
    id: agent.id,
    active_deployment_id: deployment.id,
  });
  const chat = await createTestChat(querier, {
    created_by: user.id,
    organization_id: org.id,
    agent_id: agent.id,
  });
  return { querier, user, org, agent, deployment, chat };
};

describe("chat status", async () => {
  test("multiple runs are not created when behavior=enqueue", async () => {
    const { querier, chat, agent } = await prepareChatStatusTest();
    await querier.reconcileChatRun({
      behavior: "enqueue",
      chat_id: chat.id,
      agent_id: agent.id,
    });
    await querier.reconcileChatRun({
      behavior: "enqueue",
      chat_id: chat.id,
      agent_id: agent.id,
    });

    const runs = await querier.selectChatRuns({
      chatID: chat.id,
    });
    expect(runs.items.length).toBe(1);
    expect(runs.items[0].status).toBe("streaming");

    const newChat = await querier.selectChatByID({ id: chat.id });
    expect(newChat?.last_run_number).toBe(1);
    expect(newChat?.status).toBe("streaming");
  });

  test("multiple runs are created when behavior=interrupt", async () => {
    const { querier, chat, agent } = await prepareChatStatusTest();
    await querier.reconcileChatRun({
      behavior: "enqueue",
      chat_id: chat.id,
      agent_id: agent.id,
    });
    await querier.reconcileChatRun({
      behavior: "interrupt",
      chat_id: chat.id,
      agent_id: agent.id,
    });

    const runs = await querier.selectChatRuns({
      chatID: chat.id,
    });
    expect(runs.items.length).toBe(2);
    expect(runs.items[0].status).toBe("streaming");
    expect(runs.items[1].status).toBe("interrupted");

    const newChat = await querier.selectChatByID({ id: chat.id });
    expect(newChat?.last_run_number).toBe(2);
    expect(newChat?.status).toBe("streaming");
  });

  test("chat run step status is accurate", async () => {
    const { querier, chat, agent } = await prepareChatStatusTest();
    await querier.reconcileChatRun({
      behavior: "interrupt",
      chat_id: chat.id,
      agent_id: agent.id,
    });

    const ensureStatus = async (status: ChatRunStepStatus) => {
      const latestRun = await querier.selectLatestChatRun(chat.id);
      expect(latestRun.run).toBeDefined();
      expect(latestRun.step).toBeDefined();
      expect(latestRun.step?.status).toBe(status);
    };

    await ensureStatus("streaming");
    const { step } = await querier.selectLatestChatRun(chat.id);
    if (!step) {
      throw new Error("No step found");
    }
    const oldHeartbeat = new Date(0);
    await querier.updateChatRunStep({
      id: step.id,
      error: "test error",
      completed_at: new Date(),
      interrupted_at: new Date(),
      // Even with the oldest heartbeat, this is still an error step.
      heartbeat_at: oldHeartbeat,
    });
    await ensureStatus("error");

    await querier.updateChatRunStep({
      id: step.id,
      error: null,
      completed_at: new Date(),
      interrupted_at: new Date(),
      heartbeat_at: new Date(),
    });
    await ensureStatus("interrupted");

    await querier.updateChatRunStep({
      id: step.id,
      error: null,
      completed_at: new Date(),
      interrupted_at: null,
      heartbeat_at: new Date(),
    });
    await ensureStatus("completed");

    await querier.updateChatRunStep({
      id: step.id,
      error: null,
      completed_at: null,
      interrupted_at: null,
      heartbeat_at: oldHeartbeat,
    });
    await ensureStatus("stalled");

    await querier.updateChatRunStep({
      id: step.id,
      error: null,
      completed_at: null,
      interrupted_at: null,
      heartbeat_at: new Date(),
    });
    // Ensure that we're back to streaming if all is well.
    await ensureStatus("streaming");
  });

  // When the latest step is stalled, it should recover with a new run.
  test("recovers from stalled step", async () => {
    const { querier, chat, agent } = await prepareChatStatusTest();
    await querier.reconcileChatRun({
      behavior: "interrupt",
      chat_id: chat.id,
      agent_id: agent.id,
    });

    const { step } = await querier.selectLatestChatRun(chat.id);
    if (!step) {
      throw new Error("No step found");
    }
    await querier.updateChatRunStep({
      id: step.id,
      heartbeat_at: new Date(0),
    });
    let latestRun = await querier.selectLatestChatRun(chat.id);
    expect(latestRun.run).toBeDefined();
    expect(latestRun.step).toBeDefined();
    expect(latestRun.step?.status).toBe("stalled");

    await querier.reconcileChatRun({
      behavior: "enqueue",
      chat_id: chat.id,
      agent_id: agent.id,
    });

    latestRun = await querier.selectLatestChatRun(chat.id);
    expect(latestRun.run).toBeDefined();
    expect(latestRun.step).toBeDefined();
    expect(latestRun.step?.status).toBe("streaming");

    const runs = await querier.selectChatRuns({
      chatID: chat.id,
    });
    expect(runs.items.length).toBe(2);
    expect(runs.items[0].status).toBe("streaming");
    expect(runs.items[1].status).toBe("error");
  });
});

test("parallel transactions", async () => {
  const url = await createPostgresURL();
  const querier = new Querier(await connectToPostgres(url));

  const promises: Promise<any>[] = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      // This performs a transaction internally.
      querier.insertUser({
        display_name: "test",
        email: `${crypto.randomUUID()}@test.com`,
        email_verified: new Date(),
        password: null,
      })
    );
  }
  const results = await Promise.all(promises);
  expect(results.length).toBe(10);

  console.log(results);
});

test("new user flow improvements", async () => {
  const url = await createPostgresURL();
  const querier = new Querier(await connectToPostgres(url));

  // Test 1: Username should not have -personal-org suffix
  const user1 = await querier.insertUser({
    email: "john.doe@example.com",
    display_name: "John Doe",
    email_verified: new Date(),
    password: null,
  });

  expect(user1.username).toBe("johndoe");
  expect(user1.username).not.toContain("personal-org");

  // Test 2: Avatar URL from OAuth should be set on organization
  const user2 = await querier.insertUser({
    email: "jane.smith@example.com",
    display_name: "Jane Smith",
    email_verified: new Date(),
    password: null,
    avatar_url: "https://example.com/avatar.png",
  });

  expect(user2.avatar_url).toBe("https://example.com/avatar.png");
  expect(user2.username).toBe("janesmith");
  expect(user2.username).not.toContain("personal-org");

  // Test 3: Email-based username generation (without display name)
  const user3 = await querier.insertUser({
    email: "cool-username@example.com",
    display_name: null,
    email_verified: new Date(),
    password: null,
  });

  expect(user3.username).toBe("cool-username");
  expect(user3.username).not.toContain("personal-org");
});

test("reserved usernames cannot be used", async () => {
  const url = await createPostgresURL();
  const querier = new Querier(await connectToPostgres(url));

  // Test 1: Direct user creation with reserved username should fail
  await expect(
    querier.insertUser({
      email: "user@example.com",
      display_name: "API User",
      email_verified: new Date(),
      password: null,
      username: "api",
    })
  ).rejects.toThrow('Username "api" is reserved and cannot be used.');

  // Test 2: Direct team creation with reserved name should fail
  const user = await createTestUser(querier);
  await expect(
    querier.insertOrganizationWithMembership({
      name: "help",
      created_by: user.id,
      kind: "organization",
    })
  ).rejects.toThrow('Username "help" is reserved and cannot be used.');

  // Test 3: Organization creation with reserved name should fail
  await expect(
    querier.insertOrganizationWithMembership({
      name: "docs",
      created_by: user.id,
      kind: "organization",
    })
  ).rejects.toThrow('Username "docs" is reserved and cannot be used.');

  // Test 4: Team update with reserved name should fail
  const team = await createTestOrganization(querier, { created_by: user.id });
  await expect(
    querier.updateOrganizationByID(team.id, { name: "auth" })
  ).rejects.toThrow('Username "auth" is reserved and cannot be used.');

  // Test 5: Auto-generated username that collides with reserved name should skip it
  const userWithReservedDisplayName = await querier.insertUser({
    email: "help@example.com",
    display_name: "Help",
    email_verified: new Date(),
    password: null,
  });

  // Should have generated a different username (not "help")
  expect(userWithReservedDisplayName.username).not.toBe("help");
  expect(userWithReservedDisplayName.username).toMatch(/^help-\d+$/);
});
