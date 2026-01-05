import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { type SetupServerApi, setupServer } from "msw/node";
import { serve } from "../../test";

let mswServer: SetupServerApi;

beforeEach(() => {
  mswServer = setupServer();
  mswServer.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
  if (mswServer) {
    mswServer.close();
  }
});

describe("GitHub App Setup", () => {
  test("start-creation returns manifest and github URL", async () => {
    const { helpers } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const result = await client.agents.setupGitHub.startCreation(agent.id, {
      name: "my-github-app",
    });

    expect(result.session_id).toBeDefined();
    expect(result.github_url).toBe("https://github.com/settings/apps/new");
    expect(result.manifest).toBeDefined();

    const manifest = JSON.parse(result.manifest);
    expect(manifest.name).toBe("my-github-app");
    expect(manifest.public).toBe(false);
    expect(manifest.default_permissions).toEqual({
      contents: "write",
      issues: "write",
      pull_requests: "write",
      metadata: "read",
    });
  });

  test("start-creation with organization returns organization github URL", async () => {
    const { helpers } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const result = await client.agents.setupGitHub.startCreation(agent.id, {
      name: "my-github-app",
      organization: "my-gh-org",
    });

    expect(result.github_url).toBe(
      "https://github.com/organizations/my-gh-org/settings/apps/new"
    );
  });

  test("get-creation-status returns pending for new session", async () => {
    const { helpers } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const startResult = await client.agents.setupGitHub.startCreation(
      agent.id,
      {
        name: "my-github-app",
      }
    );

    const status = await client.agents.setupGitHub.getCreationStatus(
      agent.id,
      startResult.session_id
    );

    expect(status.status).toBe("pending");
    expect(status.app_data).toBeUndefined();
    expect(status.credentials).toBeUndefined();
  });

  test("get-creation-status returns expired for invalid session", async () => {
    const { helpers } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const status = await client.agents.setupGitHub.getCreationStatus(
      agent.id,
      "invalid-session-id"
    );

    expect(status.status).toBe("expired");
  });

  test("complete-creation fails for pending session", async () => {
    const { helpers } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const startResult = await client.agents.setupGitHub.startCreation(
      agent.id,
      {
        name: "my-github-app",
      }
    );

    await expect(
      client.agents.setupGitHub.completeCreation(agent.id, {
        session_id: startResult.session_id,
      })
    ).rejects.toThrow("GitHub App creation not completed");
  });

  test("get-creation-status returns credentials when completed", async () => {
    const { helpers, url } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const startResult = await client.agents.setupGitHub.startCreation(
      agent.id,
      {
        name: "my-github-app",
      }
    );

    // Mock the GitHub API endpoint that exchanges the code for app credentials
    mswServer.use(
      http.post(
        "https://api.github.com/app-manifests/:code/conversions",
        () => {
          return HttpResponse.json({
            id: 12345,
            client_id: "Iv1.abc123",
            client_secret: "secret123",
            webhook_secret: "webhook-secret",
            pem: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
            name: "my-github-app",
            html_url: "https://github.com/apps/my-github-app",
            slug: "my-github-app",
          });
        }
      )
    );

    // Call the callback endpoint as GitHub would (redirecting with a code)
    const callbackRes = await fetch(
      `${url}/api/agents/${agent.id}/setup/github/callback?session_id=${startResult.session_id}&code=mock-code`,
      { redirect: "manual" }
    );
    // Callback should redirect to the app's installation page
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get("Location")).toBe(
      "https://github.com/apps/my-github-app/installations/new"
    );

    // Call the setup-complete endpoint as GitHub would after app installation
    const setupCompleteRes = await fetch(
      `${url}/api/agents/${agent.id}/setup/github/setup-complete?session_id=${startResult.session_id}`,
      { redirect: "manual" }
    );
    expect(setupCompleteRes.status).toBe(200);

    // Now get status should return credentials
    const status = await client.agents.setupGitHub.getCreationStatus(
      agent.id,
      startResult.session_id
    );

    expect(status.status).toBe("completed");
    expect(status.app_data).toEqual({
      id: 12345,
      name: "my-github-app",
      html_url: "https://github.com/apps/my-github-app",
      slug: "my-github-app",
    });
    expect(status.credentials).toBeDefined();
    if (!status.credentials) {
      throw new Error("Credentials should be defined");
    }
    expect(status.credentials.app_id).toBe(12345);
    expect(status.credentials.client_id).toBe("Iv1.abc123");
    expect(status.credentials.client_secret).toBe("secret123");
    expect(status.credentials.webhook_secret).toBe("webhook-secret");
    // Private key should be base64 encoded
    expect(status.credentials.private_key).toBe(
      btoa(
        "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
      )
    );
  });

  test("complete-creation clears setup state when completed", async () => {
    const { helpers, url } = await serve({
      bindings: {
        accessUrl: new URL("https://test.blink.so"),
      },
    });
    const { client } = await helpers.createUser();
    const org = await client.organizations.create({
      name: "test-org",
    });
    const agent = await client.agents.create({
      name: "test-agent",
      organization_id: org.id,
    });

    const startResult = await client.agents.setupGitHub.startCreation(
      agent.id,
      {
        name: "my-github-app",
      }
    );

    // Mock the GitHub API endpoint that exchanges the code for app credentials
    mswServer.use(
      http.post(
        "https://api.github.com/app-manifests/:code/conversions",
        () => {
          return HttpResponse.json({
            id: 12345,
            client_id: "Iv1.abc123",
            client_secret: "secret123",
            webhook_secret: "webhook-secret",
            pem: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
            name: "my-github-app",
            html_url: "https://github.com/apps/my-github-app",
            slug: "my-github-app",
          });
        }
      )
    );

    // Call the callback endpoint as GitHub would (redirecting with a code)
    await fetch(
      `${url}/api/agents/${agent.id}/setup/github/callback?session_id=${startResult.session_id}&code=mock-code`,
      { redirect: "manual" }
    );

    // Call the setup-complete endpoint as GitHub would after app installation
    await fetch(
      `${url}/api/agents/${agent.id}/setup/github/setup-complete?session_id=${startResult.session_id}`,
      { redirect: "manual" }
    );

    // Complete the creation
    const result = await client.agents.setupGitHub.completeCreation(agent.id, {
      session_id: startResult.session_id,
    });

    expect(result.success).toBe(true);
    expect(result.app_name).toBe("my-github-app");
    expect(result.app_url).toBe("https://github.com/apps/my-github-app");
    expect(result.install_url).toBe(
      "https://github.com/apps/my-github-app/installations/new"
    );

    // Verify setup state is cleared
    const status = await client.agents.setupGitHub.getCreationStatus(
      agent.id,
      startResult.session_id
    );
    expect(status.status).toBe("expired");

    // Verify no env vars were created (that's now the client's responsibility)
    const envVars = await client.agents.env.list({ agent_id: agent.id });
    expect(envVars.length).toBe(0);
  });
});
