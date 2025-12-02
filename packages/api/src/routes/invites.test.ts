import { expect, test } from "bun:test";
import { serve } from "../test";

test("CRUD /api/invites", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });
  expect(org.membership?.user_id).toBe(user.id);
  expect(org.membership?.role).toBe("owner");

  // No initial invites.
  let invites = await client.invites.list({
    organization_id: org.id,
  });
  expect(invites).toEqual([]);

  // Create an invite.
  const invite = await client.invites.create({
    organization_id: org.id,
    email: "member@example.com",
    role: "member",
  });
  expect(invite.organization_id).toBe(org.id);
  expect(invite.email).toBe("member@example.com");
  expect(invite.role).toBe("member");
  expect(invite.id).toBeString();

  // List invites.
  invites = await client.invites.list({
    organization_id: org.id,
  });
  expect(invites.length).toBe(1);
  expect(invites[0]!.id).toBe(invite.id);

  // Delete the invite.
  await client.invites.delete({
    organization_id: org.id,
    invite_id: invite.id,
  });

  // Ensure it's gone.
  invites = await client.invites.list({
    organization_id: org.id,
  });
  expect(invites).toEqual([]);
});

// Non-reusable invite can only be accepted once and sets accepted_at
test("Single-use invite: first accept succeeds, second accept fails; accepted_at set", async () => {
  const { helpers } = await serve();

  const { client: ownerClient } = await helpers.createUser();
  const org = await ownerClient.organizations.create({ name: "test-org" });

  const { client: firstInvitee } = await helpers.createUser();
  const { client: secondInvitee } = await helpers.createUser();

  // Create a non-reusable (single-use) invite explicitly
  const invite = await ownerClient.invites.create({
    organization_id: org.id,
    role: "member",
    reusable: false,
  });

  // First invitee accepts successfully
  await firstInvitee.invites.accept({
    invite_id: invite.id,
    code: invite.code,
  });

  // accepted_at should now be set when listing invites
  const invites = await ownerClient.invites.list({ organization_id: org.id });
  const listed = invites.find((i) => i.id === invite.id);
  expect(listed).toBeTruthy();
  expect(listed!.accepted_at).toBeTruthy();

  // Second invitee attempting to accept the same single-use invite should fail
  await expect(
    secondInvitee.invites.accept({ invite_id: invite.id, code: invite.code })
  ).rejects.toThrow("Invite has already been used");
});

// Invalid invite code results in 400
test("Invite accept with invalid code returns 400", async () => {
  const { helpers } = await serve();

  const { client: ownerClient } = await helpers.createUser();
  const org = await ownerClient.organizations.create({ name: "test-org" });

  const { client: invitee } = await helpers.createUser();

  const invite = await ownerClient.invites.create({
    organization_id: org.id,
    role: "member",
    reusable: false,
  });

  await expect(
    invitee.invites.accept({ invite_id: invite.id, code: "WRONG-CODE" })
  ).rejects.toThrow("Invalid code");
});
