import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { encode } from "next-auth/jwt";
import { createAuthMiddleware } from "./middleware";
import { generateAgentInvocationToken } from "./routes/agents/me/me.server";
import { parseApiKey } from "./routes/api-keys.server";
import { serve } from "./test";

const createTestApp = (middleware: MiddlewareHandler): Hono => {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(
        {
          message: err.message,
          details: err.cause,
        },
        err.status
      );
    }
    return c.json({ message: "Internal Server Error" }, 500);
  });
  app.get("/test", middleware, (c) => {
    return c.json({
      user_id: (c as any).get("user_id"),
      auth_type: (c as any).get("auth_type"),
      agent_id: (c as any).get("agent_id"),
      has_api_key: !!(c as any).get("api_key"),
    });
  });

  return app;
};

describe("createAuthMiddleware - API Key Authentication", () => {
  test("should authenticate with valid API key", async () => {
    const { bindings, helpers } = await serve();
    const { user, client } = await helpers.createUser();

    // Create API key
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
    });
    const fullKey = apiKeyData.key;

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fullKey}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user_id).toBe(user.id);
    expect(body.auth_type).toBe("api_key");
    expect(body.has_api_key).toBe(true);
  });

  test("should reject invalid API key format", async () => {
    const { bindings } = await serve();

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: "Bearer invalid_key",
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject API key with wrong prefix", async () => {
    const { bindings } = await serve();

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: "Bearer wrong_abc123xyz789_secret123",
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject API key not found in database", async () => {
    const { bindings } = await serve();

    const app = createTestApp(createAuthMiddleware());

    const fakeKey = "bk_abc123xyz789_12345678901234567890123456789012";

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fakeKey}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toBe("API key not found");
  });

  test("should reject API key with wrong secret", async () => {
    const { bindings, helpers } = await serve();
    const { client } = await helpers.createUser();

    // Create API key
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
    });
    const parsed = parseApiKey(apiKeyData.key);

    if ("error" in parsed) {
      throw new Error("Failed to parse API key");
    }

    const wrongKey = `${parsed.prefix}_${parsed.lookup}_wrongsecret123456789012345678`;

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${wrongKey}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toBe("API key failed verification");
  });

  test("should reject revoked API key", async () => {
    const { bindings, helpers } = await serve();
    const { user, client } = await helpers.createUser();

    // Create API key
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
    });
    const fullKey = apiKeyData.key;

    // Revoke the key
    const db = await bindings.database();
    const parsed = parseApiKey(fullKey);
    if ("error" in parsed) {
      throw new Error("Failed to parse API key");
    }
    const apiKey = await db.selectApiKeyByLookup(parsed.lookup);
    if (!apiKey) {
      throw new Error("API key not found");
    }
    await db.updateApiKey(apiKey.id, {
      revoked_at: new Date(),
      revoked_by: user.id,
    });

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fullKey}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toBe("API key not found");
  });

  test("should reject expired API key", async () => {
    const { bindings, helpers } = await serve();
    const { client } = await helpers.createUser();

    // Create API key
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
      expires_at: new Date(Date.now() - 1000),
    });
    const fullKey = apiKeyData.key;

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fullKey}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toBe("API key has expired");
  });

  test("should update last_used_at on successful API key auth", async () => {
    const { bindings, helpers } = await serve();
    const { client } = await helpers.createUser();

    // Create API key
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
    });
    const fullKey = apiKeyData.key;

    const db = await bindings.database();
    const parsed = parseApiKey(fullKey);
    if ("error" in parsed) {
      throw new Error("Failed to parse API key");
    }

    // Verify initial state
    const apiKeyBefore = await db.selectApiKeyByLookup(parsed.lookup);
    expect(apiKeyBefore?.last_used_at).toBeNull();

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fullKey}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);

    // Verify last_used_at was updated
    const apiKeyAfter = await db.selectApiKeyByLookup(parsed.lookup);
    expect(apiKeyAfter?.last_used_at).not.toBeNull();
    expect(apiKeyAfter?.last_used_at).toBeInstanceOf(Date);
  });
});

describe("createAuthMiddleware - Session Authentication", () => {
  test("should authenticate with valid session token in cookie", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();

    const sessionToken = await encode({
      secret: bindings.AUTH_SECRET,
      salt: "blink_session_token",
      token: {
        sub: user.id,
      },
    });

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Cookie: `blink_session_token=${encodeURIComponent(sessionToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user_id).toBe(user.id);
    expect(body.auth_type).toBe("session");
  });

  test("should authenticate with valid session token in Authorization header", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();

    const sessionToken = await encode({
      secret: bindings.AUTH_SECRET,
      salt: "blink_session_token",
      token: {
        sub: user.id,
      },
    });

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${encodeURIComponent(sessionToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user_id).toBe(user.id);
    expect(body.auth_type).toBe("session");
  });

  test("should reject invalid session token", async () => {
    const { bindings } = await serve();

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should reject missing authentication", async () => {
    const { bindings } = await serve();

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request("/test", {}, bindings);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toBe("Unauthorized");
  });
});

describe("createAuthMiddleware - Agent Authentication", () => {
  test("should authenticate with valid agent token when allowAgentAuth is true", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();
    const db = await bindings.database();

    // Create organization and agent
    const org = await db.insertOrganizationWithMembership({
      name: "Test Org",
      created_by: user.id,
    });
    const agent = await db.insertAgent({
      id: crypto.randomUUID(),
      name: "test-agent",
      organization_id: org.id,
      created_by: user.id,
      avatar_file_id: null,
    });

    const agentToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
        run_id: crypto.randomUUID(),
        step_id: crypto.randomUUID(),
        chat_id: crypto.randomUUID(),
      }
    );

    const app = createTestApp(createAuthMiddleware({ allowAgentAuth: true }));

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${encodeURIComponent(agentToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agent_id).toBe(agent.id);
    expect(body.user_id).toBeUndefined();
    expect(body.auth_type).toBe("agent");
  });

  test("should not authenticate with agent token when allowAgentAuth is false", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();
    const db = await bindings.database();

    const org = await db.insertOrganizationWithMembership({
      name: "Test Org",
      created_by: user.id,
    });
    const agent = await db.insertAgent({
      id: crypto.randomUUID(),
      name: "test-agent",
      organization_id: org.id,
      created_by: user.id,
      avatar_file_id: null,
    });

    const agentToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
      }
    );

    // allowAgentAuth defaults to false
    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${encodeURIComponent(agentToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(401);
  });

  test("should use custom findAgentToken function", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();
    const db = await bindings.database();

    const org = await db.insertOrganizationWithMembership({
      name: "Test Org",
      created_by: user.id,
    });
    const agent = await db.insertAgent({
      id: crypto.randomUUID(),
      name: "test-agent",
      organization_id: org.id,
      created_by: user.id,
      avatar_file_id: null,
    });

    const agentToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
      }
    );

    const app = createTestApp(
      createAuthMiddleware({
        allowAgentAuth: true,
        findAgentToken: (req) => {
          return new URL(req.url).searchParams.get("token");
        },
      })
    );

    const response = await app.request(
      `/test?token=${encodeURIComponent(agentToken)}`,
      {},
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agent_id).toBe(agent.id);
    expect(body.auth_type).toBe("agent");
  });

  test("should fall back to session auth when agent token is invalid", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();

    const sessionToken = await encode({
      secret: bindings.AUTH_SECRET,
      salt: "blink_session_token",
      token: {
        sub: user.id,
      },
    });

    const app = createTestApp(createAuthMiddleware({ allowAgentAuth: true }));

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${encodeURIComponent(sessionToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user_id).toBe(user.id);
    expect(body.agent_id).toBeUndefined();
    expect(body.auth_type).toBe("session");
  });
});

describe("createAuthMiddleware - Authentication Priority", () => {
  test("should prioritize API key over session token", async () => {
    const { bindings, helpers } = await serve();
    const { client } = await helpers.createUser();
    const { user: user2 } = await helpers.createUser();

    // Create API key for user1
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
    });
    const fullKey = apiKeyData.key;

    // Create session token for user2
    const sessionToken = await encode({
      secret: bindings.AUTH_SECRET,
      salt: "blink_session_token",
      token: {
        sub: user2.id,
      },
    });

    const app = createTestApp(createAuthMiddleware());

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fullKey}`,
          Cookie: `blink_session_token=${encodeURIComponent(sessionToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // Should authenticate as API key user, not session user
    expect(body.user_id).toBe(apiKeyData.user_id);
    expect(body.auth_type).toBe("api_key");
  });

  test("should prioritize API key over agent token", async () => {
    const { bindings, helpers } = await serve();
    const { user, client } = await helpers.createUser();
    const db = await bindings.database();

    // Create API key
    const apiKeyData = await client.users.createApiKey({
      name: "Test Key",
    });
    const fullKey = apiKeyData.key;

    // Create agent token
    const org = await db.insertOrganizationWithMembership({
      name: "Test Org",
      created_by: user.id,
    });
    const agent = await db.insertAgent({
      id: crypto.randomUUID(),
      name: "test-agent",
      organization_id: org.id,
      created_by: user.id,
      avatar_file_id: null,
    });

    const agentToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
      }
    );

    const app = createTestApp(createAuthMiddleware({ allowAgentAuth: true }));

    const response = await app.request(
      "/test",
      {
        headers: {
          Authorization: `Bearer ${fullKey}`,
          Cookie: `blink_session_token=${encodeURIComponent(agentToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // Should use API key, not agent token
    expect(body.user_id).toBe(user.id);
    expect(body.agent_id).toBeUndefined();
    expect(body.auth_type).toBe("api_key");
  });

  test("should prioritize agent token over session token", async () => {
    const { bindings, helpers } = await serve();
    const { user } = await helpers.createUser();
    const { user: user2 } = await helpers.createUser();
    const db = await bindings.database();

    // Create agent for user1
    const org = await db.insertOrganizationWithMembership({
      name: "Test Org",
      created_by: user.id,
    });
    const agent = await db.insertAgent({
      id: crypto.randomUUID(),
      name: "test-agent",
      organization_id: org.id,
      created_by: user.id,
      avatar_file_id: null,
    });

    const agentToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: crypto.randomUUID(),
      }
    );

    // Create session token for user2
    const sessionToken = await encode({
      secret: bindings.AUTH_SECRET,
      salt: "blink_session_token",
      token: {
        sub: user2.id,
      },
    });

    const app = createTestApp(createAuthMiddleware({ allowAgentAuth: true }));

    const response = await app.request(
      "/test",
      {
        headers: {
          Cookie: `blink_session_token=${encodeURIComponent(agentToken)}`,
          Authorization: `Bearer ${encodeURIComponent(sessionToken)}`,
        },
      },
      bindings
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // Should use agent token from cookie, not session from Authorization
    expect(body.agent_id).toBe(agent.id);
    expect(body.user_id).toBeUndefined();
    expect(body.auth_type).toBe("agent");
  });
});
