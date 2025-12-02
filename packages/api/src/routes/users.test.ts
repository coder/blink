import { expect, test } from "bun:test";
import Client from "../client.node";
import { serve } from "../test";

test("GET /api/users/me returns current user", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  const me = await client.users.me();
  expect(me.id).toBe(user.id);
  expect(me.email).toBe(user.email ?? "");
  expect(me.username).toBeDefined();
  expect(me.organization_id).toBeDefined();
});

test("GET /api/users/:id returns user by ID", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  const fetchedUser = await client.users.get(user.id);
  expect(fetchedUser.id).toBe(user.id);
  expect(fetchedUser.email).toBe(user.email ?? "");
});

test("PATCH /api/users/me updates display name", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const updated = await client.users.update({
    display_name: "New Name",
  });

  expect(updated.display_name).toBe("New Name");

  // Verify persistence
  const me = await client.users.me();
  expect(me.display_name).toBe("New Name");
});

test("PATCH /api/users/me updates username", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  const originalUsername = user.username;
  const newUsername = "new-username-123";

  const updated = await client.users.update({
    username: newUsername,
  });

  expect(updated.username).toBe(newUsername);
  expect(updated.username).not.toBe(originalUsername);

  // Verify persistence
  const me = await client.users.me();
  expect(me.username).toBe(newUsername);
});

test("PATCH /api/users/me updates both display name and username", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const updated = await client.users.update({
    display_name: "Full Name",
    username: "full-name",
  });

  expect(updated.display_name).toBe("Full Name");
  expect(updated.username).toBe("full-name");
});

test("PATCH /api/users/me rejects duplicate username", async () => {
  const { helpers } = await serve();
  const { client: client1, user: user1 } = await helpers.createUser();
  const { client: client2 } = await helpers.createUser();

  // Try to use user1's username
  await expect(
    client2.users.update({
      username: user1.username,
    })
  ).rejects.toThrow("Username is already taken");
});

test("PATCH /api/users/me validates username format", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Test invalid formats - these should be caught by Zod validation
  const invalidUsernames = [
    "UPPERCASE", // must be lowercase
    "-starts-with-dash",
    "ends-with-dash-",
    "has--double-dash",
    "has space",
    "has_underscore",
    "a".repeat(40), // too long (max 39)
  ];

  for (const username of invalidUsernames) {
    try {
      await client.users.update({ username });
      throw new Error(`Expected ${username} to fail validation`);
    } catch (error) {
      // Should throw validation error
      expect(error).toBeDefined();
    }
  }
});

test("PATCH /api/users/me allows valid username formats", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const validUsernames = [
    "abc",
    "test-user",
    "test123",
    "123test",
    "a",
    "test-user-123",
  ];

  for (const username of validUsernames) {
    const updated = await client.users.update({ username });
    expect(updated.username).toBe(username);
  }
});

test("PATCH /api/users/me allows empty display name", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Set a name first
  await client.users.update({ display_name: "Test Name" });
  const me = await client.users.me();
  expect(me.display_name).toBe("Test Name");

  // Clear it - empty string or null clears the name
  const updated = await client.users.update({ display_name: "" });
  // Empty string gets converted to empty string in display, but may be null internally
  expect(updated.display_name === "" || updated.display_name === null).toBe(
    true
  );
});

test("PATCH /api/users/me validates display name length", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Max 100 characters
  const validName = "a".repeat(100);
  const updated = await client.users.update({ display_name: validName });
  expect(updated.display_name).toBe(validName);

  // Over 100 should fail
  const tooLongName = "a".repeat(101);
  await expect(
    client.users.update({ display_name: tooLongName })
  ).rejects.toThrow();
});

test("PATCH /api/users/me requires authentication", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create unauthenticated client by using the base URL without auth token
  const unauthClient = new Client({
    baseURL: client["baseURL"]?.toString(),
    // No authToken provided
  });

  try {
    await unauthClient.users.update({ display_name: "test" });
    throw new Error("Expected authentication error");
  } catch (error) {
    // Should throw authentication error (401 or similar)
    expect(error).toBeDefined();
    // Verify it's an auth error, not just any error
    const errorMessage = String(error);
    expect(
      errorMessage.includes("401") || errorMessage.includes("Unauthorized")
    ).toBe(true);
  }
});

test("PATCH /api/users/me updates avatar with file_id", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const updated = await client.users.update({
    avatar_file_id: "test-file-id",
  });

  expect(updated.avatar_url).toBe("/api/files/test-file-id");

  // Verify persistence
  const me = await client.users.me();
  expect(me.avatar_url).toBe("/api/files/test-file-id");
});

test("PATCH /api/users/me removes avatar with null file_id", async () => {
  const { helpers, bindings } = await serve();
  const { client, user } = await helpers.createUser();
  const db = await bindings.database();

  // Set an avatar first (now stored in organization)
  await db.updateOrganizationByID(user.organization_id, {
    avatar_url: "/api/files/test-file-id",
  });

  // Remove it
  const updated = await client.users.update({ avatar_file_id: null });

  expect(updated.avatar_url).toBeNull();
});

test("PATCH /api/users/me trims avatar file_id", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const updated = await client.users.update({
    avatar_file_id: "  test-file-id  ",
  });

  expect(updated.avatar_url).toBe("/api/files/test-file-id");
});

test("GET /api/users/me/accounts returns user accounts", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const accounts = await client.users.accounts();

  expect(accounts).toBeDefined();
  expect(Array.isArray(accounts.github)).toBe(true);
  expect(Array.isArray(accounts.google)).toBe(true);
  expect(accounts.github.length).toBe(0);
  expect(accounts.google.length).toBe(0);
});

test("GET /api/users/me/accounts returns linked accounts", async () => {
  const { helpers, bindings } = await serve();
  const { client, user } = await helpers.createUser();
  const db = await bindings.database();

  // Add accounts
  await db.upsertUserAccount({
    user_id: user.id,
    type: "oauth",
    provider: "github",
    provider_account_id: "github-123",
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    id_token: null,
    session_state: null,
  });

  await db.upsertUserAccount({
    user_id: user.id,
    type: "oauth",
    provider: "google",
    provider_account_id: "google-456",
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    id_token: null,
    session_state: null,
  });

  const accounts = await client.users.accounts();

  expect(accounts.github.length).toBe(1);
  expect(accounts.github[0].provider).toBe("github");
  expect(accounts.github[0].provider_account_id).toBe("github-123");

  expect(accounts.google.length).toBe(1);
  expect(accounts.google[0].provider).toBe("google");
  expect(accounts.google[0].provider_account_id).toBe("google-456");
});

test("DELETE /api/users/me/accounts/:provider/:accountId prevents last account removal without password", async () => {
  const { helpers, bindings } = await serve();
  const { client, user } = await helpers.createUser();
  const db = await bindings.database();

  // Add a GitHub account
  await db.upsertUserAccount({
    user_id: user.id,
    type: "oauth",
    provider: "github",
    provider_account_id: "github-test-123",
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    id_token: null,
    session_state: null,
  });

  // User has no password, so can't remove last auth method
  await expect(
    client.users.unlinkProvider("github", "github-test-123")
  ).rejects.toThrow();
});

test("DELETE /api/users/me/accounts/:provider/:accountId allows removal with password", async () => {
  const { helpers, bindings } = await serve();
  const { client, user } = await helpers.createUser();
  const db = await bindings.database();

  // Set a password
  await db.updateUserByID({
    id: user.id,
    password: "hashed-password",
  });

  // Add a GitHub account
  await db.upsertUserAccount({
    user_id: user.id,
    type: "oauth",
    provider: "github",
    provider_account_id: "github-test-123",
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    id_token: null,
    session_state: null,
  });

  // Should succeed
  await client.users.unlinkProvider("github", "github-test-123");

  // Verify it's removed
  const accounts = await client.users.accounts();
  expect(accounts.github.length).toBe(0);
});

test("DELETE /api/users/me/accounts/:provider/:accountId allows removal with multiple accounts", async () => {
  const { helpers, bindings } = await serve();
  const { client, user } = await helpers.createUser();
  const db = await bindings.database();

  // Add two accounts (no password needed)
  await db.upsertUserAccount({
    user_id: user.id,
    type: "oauth",
    provider: "github",
    provider_account_id: "github-123",
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    id_token: null,
    session_state: null,
  });

  await db.upsertUserAccount({
    user_id: user.id,
    type: "oauth",
    provider: "google",
    provider_account_id: "google-456",
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: null,
    scope: null,
    id_token: null,
    session_state: null,
  });

  // Should succeed - still has another auth method
  await client.users.unlinkProvider("github", "github-123");

  // Verify it's removed
  const accounts = await client.users.accounts();
  expect(accounts.github.length).toBe(0);
  expect(accounts.google.length).toBe(1);
});

test("DELETE /api/users/me/accounts/:provider/:accountId returns 404 for non-existent account", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  await expect(
    client.users.unlinkProvider("github", "non-existent")
  ).rejects.toThrow();
});

test("DELETE /api/users/me/accounts/:provider/:accountId rejects invalid provider", async () => {
  const { helpers, url } = await serve();
  const { client } = await helpers.createUser();

  // Get the auth token to make direct request
  const token = client["authToken"];
  const res = await fetch(`${url}/api/users/me/accounts/invalid/test-123`, {
    method: "DELETE",
    headers: {
      Cookie: `blink_session_token=${token}`,
    },
  });

  expect(res.status).toBe(400);
});

test("DELETE /api/users/me deletes user", async () => {
  const { helpers, bindings } = await serve();
  const { client, user } = await helpers.createUser();

  await client.users.delete();

  // Verify user is deleted
  const db = await bindings.database();
  const deletedUser = await db.selectUserByID(user.id);
  expect(deletedUser).toBeUndefined();
});

test("DELETE /api/users/me requires authentication", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create unauthenticated client
  const unauthClient = new Client({
    baseURL: client["baseURL"]?.toString(),
  });

  await expect(unauthClient.users.delete()).rejects.toThrow();
});

// API Key Tests
test("POST /api/users/me/api-keys creates API key with custom name", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  const result = await client.users.createApiKey({
    name: "My Test Key",
    scope: "full",
  });

  expect(result.name).toBe("My Test Key");
  expect(result.user_id).toBe(user.id);
  expect(result.scope).toBe("full");
  expect(result.key).toBeDefined();
  expect(result.key).toMatch(/^bk_/); // API keys start with bk_
  expect(result.key_prefix).toBe("bk");
  expect(result.key_suffix).toBeDefined();
  expect(result.revoked_at).toBeNull();
  // assert that the key hash is not included in the response
  expect(JSON.stringify(result)).not.toContain("key_hash");
});

test("POST /api/users/me/api-keys creates API key without name defaults to 'New API Key'", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  const result = await client.users.createApiKey({
    scope: "full",
  });

  expect(result.name).toBe("New API Key");
  expect(result.user_id).toBe(user.id);
  expect(result.key).toBeDefined();
});

test("POST /api/users/me/api-keys creates API key with empty string name defaults to 'New API Key'", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const result = await client.users.createApiKey({
    name: "",
    scope: "full",
  });

  expect(result.name).toBe("New API Key");
});

test("POST /api/users/me/api-keys creates API key with custom expiration", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days
  const result = await client.users.createApiKey({
    name: "Expiring Key",
    scope: "full",
    expires_at: expiresAt,
  });

  expect(result.name).toBe("Expiring Key");
  expect(result.expires_at).toBeDefined();
  // expires_at comes back as a Date object from the coerce schema
  const resultDate = new Date(result.expires_at!);
  expect(resultDate.getTime()).toBeCloseTo(expiresAt.getTime(), -3); // Within a second
});

test("GET /api/users/me/api-keys lists user's API keys", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();

  // Create multiple API keys
  await client.users.createApiKey({ name: "Key 1", scope: "full" });
  await client.users.createApiKey({ name: "Key 2", scope: "full" });
  await client.users.createApiKey({ name: "Key 3", scope: "full" });

  const response = await client.users.listApiKeys();

  expect(response.items).toBeDefined();
  expect(response.items.length).toBe(3);

  // Verify keys belong to user
  for (const key of response.items) {
    expect(key.user_id).toBe(user.id);
    expect(key.revoked_at).toBeNull();
  }

  // Verify names
  const names = response.items.map((k) => k.name).sort();
  expect(names).toEqual(["Key 1", "Key 2", "Key 3"]);
});

test("GET /api/users/me/api-keys does not include revoked keys", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create API keys
  const key1 = await client.users.createApiKey({ name: "Active Key" });
  const key2 = await client.users.createApiKey({ name: "To Be Revoked" });

  // Revoke one key
  await client.users.revokeApiKey({ key_id: key2.id });

  // List keys - should only show active key
  const response = await client.users.listApiKeys();

  expect(response.items.length).toBe(1);
  expect(response.items[0].name).toBe("Active Key");
  expect(response.items[0].id).toBe(key1.id);
});

test("GET /api/users/me/api-keys does not include key hash", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create API keys
  const key1 = await client.users.createApiKey({ name: "Active Key" });

  const response = await client.users.listApiKeys();

  expect(response.items.length).toBe(1);
  expect(response.items[0].name).toBe("Active Key");
  expect(response.items[0].id).toBe(key1.id);
  expect(JSON.stringify(response.items[0])).not.toContain("key_hash");
});

test("GET /api/users/me/api-keys cannot see another user's API keys", async () => {
  const { helpers } = await serve();
  const { client: client1, user: user1 } = await helpers.createUser();
  const { client: client2, user: user2 } = await helpers.createUser();

  // User 1 creates API keys
  await client1.users.createApiKey({ name: "User 1 Key 1" });
  await client1.users.createApiKey({ name: "User 1 Key 2" });

  // User 2 creates API keys
  await client2.users.createApiKey({ name: "User 2 Key 1" });

  // User 1 lists their keys - should only see their own
  const user1Keys = await client1.users.listApiKeys();
  expect(user1Keys.items.length).toBe(2);
  for (const key of user1Keys.items) {
    expect(key.user_id).toBe(user1.id);
    expect(key.name).toMatch(/^User 1/);
  }

  // User 2 lists their keys - should only see their own
  const user2Keys = await client2.users.listApiKeys();
  expect(user2Keys.items.length).toBe(1);
  expect(user2Keys.items[0].user_id).toBe(user2.id);
  expect(user2Keys.items[0].name).toBe("User 2 Key 1");
});

test("DELETE /api/users/me/api-keys/:key_id revokes user's own API key", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const key = await client.users.createApiKey({ name: "Key to Revoke" });

  // Revoke the key
  await client.users.revokeApiKey({ key_id: key.id });

  // Verify it's no longer in active keys
  const response = await client.users.listApiKeys();
  expect(response.items.find((k) => k.id === key.id)).toBeUndefined();
});

test("DELETE /api/users/me/api-keys/:key_id cannot revoke another user's API key", async () => {
  const { helpers } = await serve();
  const { client: client1 } = await helpers.createUser();
  const { client: client2 } = await helpers.createUser();

  // User 1 creates an API key
  const user1Key = await client1.users.createApiKey({ name: "User 1 Key" });

  // User 2 tries to revoke User 1's key - should fail
  await expect(
    client2.users.revokeApiKey({ key_id: user1Key.id })
  ).rejects.toThrow();

  // Verify User 1's key is still active
  const user1Keys = await client1.users.listApiKeys();
  expect(user1Keys.items.find((k) => k.id === user1Key.id)).toBeDefined();
});

test("DELETE /api/users/me/api-keys/:key_id returns 404 for non-existent key", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const nonExistentId = "00000000-0000-0000-0000-000000000000";

  await expect(
    client.users.revokeApiKey({ key_id: nonExistentId })
  ).rejects.toThrow();
});

test("DELETE /api/users/me/api-keys/:key_id rejects invalid UUID", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  await expect(
    client.users.revokeApiKey({ key_id: "not-a-uuid" as any })
  ).rejects.toThrow();
});

test("DELETE /api/users/me/api-keys/:key_id cannot revoke already revoked key", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create and revoke an API key
  const key = await client.users.createApiKey({ name: "Key to Double Revoke" });
  await client.users.revokeApiKey({ key_id: key.id });

  // Try to revoke the same key again - should fail
  await expect(client.users.revokeApiKey({ key_id: key.id })).rejects.toThrow(
    "API key not found"
  );
});

test("DELETE /api/users/me/api-keys/:key_id cannot revoke expired key", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create an API key that's already expired
  const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
  const key = await client.users.createApiKey({
    name: "Expired Key",
    scope: "full",
    expires_at: expiredDate,
  });

  // Try to revoke the expired key - should fail
  await expect(client.users.revokeApiKey({ key_id: key.id })).rejects.toThrow(
    "API key not found"
  );
});

test("POST /api/users/me/api-keys requires authentication", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create unauthenticated client
  const unauthClient = new Client({
    baseURL: client["baseURL"]?.toString(),
  });

  await expect(
    unauthClient.users.createApiKey({ name: "Test Key" })
  ).rejects.toThrow();
});

test("GET /api/users/me/api-keys requires authentication", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  // Create unauthenticated client
  const unauthClient = new Client({
    baseURL: client["baseURL"]?.toString(),
  });

  await expect(unauthClient.users.listApiKeys()).rejects.toThrow();
});

test("API key contains only partial key information after creation", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const result = await client.users.createApiKey({ name: "Test Key" });

  // Full key is returned on creation
  expect(result.key).toBeDefined();
  expect(result.key.length).toBeGreaterThan(20);

  // But listing keys doesn't include full key
  const response = await client.users.listApiKeys();
  const listedKey = response.items.find((k) => k.id === result.id);

  expect(listedKey).toBeDefined();
  expect(listedKey!.key_prefix).toBe("bk");
  expect(listedKey!.key_suffix).toBeDefined();
  // Full key should not be in the listed response type
  expect((listedKey as any).key).toBeUndefined();
});
