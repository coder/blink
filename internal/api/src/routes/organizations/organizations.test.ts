import { expect, test } from "bun:test";
import { serve } from "../../test";

test("CRUD /api/organizations", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  // No initial organizations.
  let orgs = await client.organizations.list();
  expect(orgs).toHaveLength(1);
  const personal = orgs[0]!;

  // Create an organization.
  let org = await client.organizations.create({
    name: "test-org",
  });
  expect(org.name).toBe("test-org");
  expect(org.membership).toBeDefined();
  expect(org.membership?.user_id).toBe(user.id);
  expect(org.membership?.role).toBe("owner");

  // List organizations.
  orgs = await client.organizations.list();
  expect(orgs).toEqual([personal, org]);

  // Get the organization.
  org = await client.organizations.get(org.id);
  expect(org.name).toBe("test-org");

  // Delete the organization.
  await client.organizations.delete(org.id);
  orgs = await client.organizations.list();
  expect(orgs).toEqual([personal]);
});

test("create organization with duplicate name", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  await client.organizations.create({
    name: "test-org",
  });

  await expect(
    client.organizations.create({
      name: "test-ORG",
    })
  ).rejects.toThrow("That name is already taken!");
});

test("update organization name", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "original-name",
  });

  const updated = await client.organizations.update(org.id, {
    name: "updated-name",
  });

  expect(updated.name).toBe("updated-name");
  expect(updated.id).toBe(org.id);

  const fetched = await client.organizations.get(org.id);
  expect(fetched.name).toBe("updated-name");
});

test("create organization disabled when enableMultiOrg is false", async () => {
  const { helpers } = await serve({
    bindings: {
      enableMultiOrg: false,
    },
  });
  const { client } = await helpers.createUser();

  await expect(
    client.organizations.create({
      name: "test-org",
    })
  ).rejects.toThrow("Creating new organizations is disabled");
});

test("delete organization disabled when enableMultiOrg is false", async () => {
  const { helpers } = await serve({
    bindings: {
      enableMultiOrg: false,
    },
  });
  const { client } = await helpers.createUser();

  // Get the personal org
  const orgs = await client.organizations.list();
  const personalOrg = orgs[0]!;

  // Try to delete the personal org - should fail because multi-org is disabled
  await expect(client.organizations.delete(personalOrg.id)).rejects.toThrow(
    "Deleting organizations is disabled"
  );
});
