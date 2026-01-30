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
