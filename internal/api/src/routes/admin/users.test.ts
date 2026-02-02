import { expect, test } from "bun:test";
import Client from "../../client.node";
import { serve } from "../../test";

test("GET /api/admin/users returns 403 for non-admin user", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser({ site_role: "member" });

  await expect(client.admin.users.list()).rejects.toThrow("Forbidden");
});

test("GET /api/admin/users returns users for site admin", async () => {
  const { helpers } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });
  const { user: regularUser } = await helpers.createUser({
    site_role: "member",
  });

  const response = await adminClient.admin.users.list();

  expect(response.items).toBeDefined();
  expect(response.items.length).toBeGreaterThanOrEqual(2);

  const regularUserInList = response.items.find((u) => u.id === regularUser.id);
  expect(regularUserInList).toBeDefined();
  expect(regularUserInList?.site_role).toBe("member");
});

test("GET /api/admin/users returns 401 for unauthenticated request", async () => {
  const { url } = await serve();

  const unauthClient = new Client({
    baseURL: url.toString(),
  });

  await expect(unauthClient.admin.users.list()).rejects.toThrow("Unauthorized");
});

test("GET /api/admin/users filters by site_role", async () => {
  const { helpers } = await serve();
  const { client: adminClient, user: adminUser } = await helpers.createUser({
    site_role: "admin",
  });
  const { user: memberUser } = await helpers.createUser({
    site_role: "member",
  });

  const adminOnly = await adminClient.admin.users.list({ site_role: "admin" });

  expect(adminOnly.items.every((u) => u.site_role === "admin")).toBe(true);
  expect(adminOnly.items.some((u) => u.id === adminUser.id)).toBe(true);
  expect(adminOnly.items.some((u) => u.id === memberUser.id)).toBe(false);
});

test("GET /api/admin/users filters by query", async () => {
  const { helpers } = await serve();
  const { client: adminClient, user: adminUser } = await helpers.createUser({
    site_role: "admin",
    email: "admin-unique-email@example.com",
  });
  const { user: otherUser } = await helpers.createUser({
    site_role: "member",
    email: "other-user@example.com",
  });

  const results = await adminClient.admin.users.list({
    query: "admin-unique-email",
  });

  expect(results.items.length).toBeGreaterThanOrEqual(1);
  expect(results.items.some((u) => u.id === adminUser.id)).toBe(true);
  expect(results.items.some((u) => u.id === otherUser.id)).toBe(false);
});

test("GET /api/admin/users includes suspended field", async () => {
  const { helpers } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });

  const response = await adminClient.admin.users.list();

  expect(response.items.length).toBeGreaterThanOrEqual(1);
  expect(response.items[0].suspended).toBe(false);
});

test("PATCH /api/admin/users/:id/suspension returns 403 for non-admin user", async () => {
  const { helpers } = await serve();
  const { client: memberClient } = await helpers.createUser({
    site_role: "member",
  });
  const { user: targetUser } = await helpers.createUser({
    site_role: "member",
  });

  await expect(
    memberClient.admin.users.updateSuspension(targetUser.id, true)
  ).rejects.toThrow("Forbidden");
});

test("PATCH /api/admin/users/:id/suspension successfully suspends a user", async () => {
  const { helpers } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });
  const { user: targetUser } = await helpers.createUser({
    site_role: "member",
  });

  const result = await adminClient.admin.users.updateSuspension(
    targetUser.id,
    true
  );

  expect(result.id).toBe(targetUser.id);
  expect(result.suspended).toBe(true);
});

test("PATCH /api/admin/users/:id/suspension successfully unsuspends a user", async () => {
  const { helpers } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });
  const { user: targetUser } = await helpers.createUser({
    site_role: "member",
  });

  // First suspend the user
  await adminClient.admin.users.updateSuspension(targetUser.id, true);

  // Then unsuspend
  const result = await adminClient.admin.users.updateSuspension(
    targetUser.id,
    false
  );

  expect(result.id).toBe(targetUser.id);
  expect(result.suspended).toBe(false);
});

test("PATCH /api/admin/users/:id/suspension returns 400 when trying to suspend yourself", async () => {
  const { helpers } = await serve();
  const { client: adminClient, user: adminUser } = await helpers.createUser({
    site_role: "admin",
  });

  await expect(
    adminClient.admin.users.updateSuspension(adminUser.id, true)
  ).rejects.toThrow("Cannot suspend your own account");
});

test("PATCH /api/admin/users/:id/suspension returns 404 for non-existent user", async () => {
  const { helpers } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });

  await expect(
    adminClient.admin.users.updateSuspension(
      "00000000-0000-0000-0000-000000000000",
      true
    )
  ).rejects.toThrow("User not found");
});

test("suspended user cannot authenticate with session", async () => {
  const { helpers } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });
  const { client: targetClient, user: targetUser } = await helpers.createUser({
    site_role: "member",
  });

  // Verify user can access API before suspension
  const orgs = await targetClient.organizations.list();
  expect(orgs).toBeDefined();
  expect(Array.isArray(orgs)).toBe(true);

  // Suspend the user
  await adminClient.admin.users.updateSuspension(targetUser.id, true);

  // Verify suspended user cannot access API
  await expect(targetClient.organizations.list()).rejects.toThrow(
    "Account suspended"
  );
});

test("suspended user cannot authenticate with API key", async () => {
  const { helpers, url } = await serve();
  const { client: adminClient } = await helpers.createUser({
    site_role: "admin",
  });
  const { client: targetClient, user: targetUser } = await helpers.createUser({
    site_role: "member",
  });

  // Create an API key for the target user
  const apiKey = await targetClient.users.createApiKey({
    name: "Test API Key",
  });
  const targetApiKeyClient = new Client({
    baseURL: url.toString(),
    authToken: apiKey.key,
  });

  // Verify user can access API before suspension
  const orgs = await targetApiKeyClient.organizations.list();
  expect(orgs).toBeDefined();
  expect(Array.isArray(orgs)).toBe(true);

  // Suspend the user
  await adminClient.admin.users.updateSuspension(targetUser.id, true);

  // Verify suspended user cannot access API with API key
  await expect(targetApiKeyClient.organizations.list()).rejects.toThrow(
    "Account suspended"
  );
});
