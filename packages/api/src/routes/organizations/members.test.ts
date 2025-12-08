import { expect, test } from "bun:test";
import { serve } from "../../test";

test("CRUD /api/organizations/:id/members", async () => {
  const { helpers, bindings } = await serve();
  const { client, user: owner } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });

  // Initially, only the owner is listed.
  let members = await client.organizations.members.list({
    organization_id: org.id,
  });
  expect(members.items.map((m) => m.user_id)).toEqual([owner.id]);

  const { client: invitedClient, user: invitedUser } =
    await helpers.createUser();

  // Create an invite as owner via API
  const invite = await client.invites.create({
    organization_id: org.id,
    email: invitedUser.email!,
    role: "member",
  });

  await invitedClient.invites.accept({
    invite_id: invite.id,
    code: invite.code,
  });

  // Verify both members are present now.
  members = await client.organizations.members.list({
    organization_id: org.id,
  });
  expect(members.items.length).toBe(2);
  const userIds = members.items.map((m) => m.user_id).sort();
  expect(userIds).toEqual([invitedUser.id, owner.id].sort());

  // Get the invited user's membership via API
  const member = await client.organizations.members.get({
    organization_id: org.id,
    user_id: invitedUser.id,
  });
  expect(member.user_id).toBe(invitedUser.id);
  expect(member.role).toBe("member");

  // Update the invited user's role via API
  const updated = await client.organizations.members.update({
    organization_id: org.id,
    user_id: invitedUser.id,
    role: "admin",
  });
  expect(updated.user_id).toBe(invitedUser.id);
  expect(updated.role).toBe("admin");

  // Remove the invited user via API
  await client.organizations.members.delete({
    organization_id: org.id,
    user_id: invitedUser.id,
  });

  // Ensure they are gone
  members = await client.organizations.members.list({
    organization_id: org.id,
  });
  expect(members.items.map((m) => m.user_id)).toEqual([owner.id]);
});

test("Search organization members by query", async () => {
  const { helpers } = await serve();
  const { client, user: owner } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });

  // Create multiple users with different attributes
  const { client: client1, user: user1 } = await helpers.createUser({
    username: "alice",
    display_name: "Alice Smith",
    email: "alice@example.com",
  });

  const { client: client2, user: user2 } = await helpers.createUser({
    username: "bob",
    display_name: "Bob Johnson",
    email: "bob@example.com",
  });

  const { client: client3, user: user3 } = await helpers.createUser({
    username: "charlie",
    display_name: "Charlie Brown",
    email: "charlie@test.com",
  });

  // Invite all users to the organization
  for (const user of [user1, user2, user3]) {
    const invite = await client.invites.create({
      organization_id: org.id,
      email: user.email!,
      role: "member",
    });
    const userClient =
      user.id === user1.id ? client1 : user.id === user2.id ? client2 : client3;
    await userClient.invites.accept({
      invite_id: invite.id,
      code: invite.code,
    });
  }

  // Search by username
  let members = await client.organizations.members.list({
    organization_id: org.id,
    query: "alice",
  });
  expect(members.items.length).toBe(1);
  expect(members.items[0].user.username).toBe("alice");

  // Search by display name
  members = await client.organizations.members.list({
    organization_id: org.id,
    query: "Johnson",
  });
  expect(members.items.length).toBe(1);
  expect(members.items[0].user.display_name).toBe("Bob Johnson");

  // Search by email
  members = await client.organizations.members.list({
    organization_id: org.id,
    query: "charlie@test.com",
  });
  expect(members.items.length).toBe(1);
  expect(members.items[0].user.email).toBe("charlie@test.com");

  // Search with partial match
  members = await client.organizations.members.list({
    organization_id: org.id,
    query: "example",
  });
  expect(members.items.length).toBe(2);
  const emails = members.items.map((m) => m.user.email).sort();
  expect(emails).toEqual(["alice@example.com", "bob@example.com"]);

  // Search with no matches
  members = await client.organizations.members.list({
    organization_id: org.id,
    query: "nonexistent",
  });
  expect(members.items.length).toBe(0);

  // No query returns all members
  members = await client.organizations.members.list({
    organization_id: org.id,
  });
  expect(members.items.length).toBe(4); // owner + 3 invited users
});
