import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";

import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
} from "../../middleware";
import type { Bindings } from "../../server";
import {
  schemaCompleteGitHubAppCreationRequest,
  schemaGitHubAppData,
  schemaStartGitHubAppCreationRequest,
  type CompleteGitHubAppCreationResponse,
  type GitHubAppCreationStatusResponse,
  type GitHubAppData,
  type StartGitHubAppCreationResponse,
} from "./setup-github.client";

// 10 minute expiry for GitHub App creation sessions
const SESSION_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Create the GitHub App manifest for the manifest flow.
 */
function createGitHubAppManifest(
  name: string,
  webhookUrl: string,
  callbackUrl: string
) {
  return {
    name,
    url: "https://blink.so",
    description: "A Blink agent for GitHub",
    public: false,
    redirect_url: callbackUrl,
    hook_attributes: {
      url: webhookUrl,
      active: true,
    },
    default_events: [
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "push",
    ],
    default_permissions: {
      contents: "write",
      issues: "write",
      pull_requests: "write",
      metadata: "read",
    },
  };
}

/**
 * Create the URL for the GitHub App manifest flow.
 */
function createGitHubManifestUrl(
  manifest: object,
  organization?: string
): string {
  const baseUrl = organization
    ? `https://github.com/organizations/${organization}/settings/apps/new`
    : `https://github.com/settings/apps/new`;

  return `${baseUrl}?manifest=${encodeURIComponent(JSON.stringify(manifest))}`;
}

export default function mountSetupGitHub(
  app: Hono<{
    Bindings: Bindings;
  }>
) {
  // Get webhook URL (no credentials required)
  app.get(
    "/webhook-url",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();

      // Get the agent's production deployment target for webhook URL
      const target = await db.selectAgentDeploymentTargetByName(
        agent.id,
        "production"
      );
      if (!target) {
        return c.json({ error: "No deployment target found" }, 400);
      }

      if (!c.env.accessUrl) {
        return c.json(
          { error: "Access URL not configured on this deployment" },
          500
        );
      }
      const webhookUrl = `${c.env.accessUrl.origin}/api/webhook/${target.request_id}/github`;

      return c.json({ webhook_url: webhookUrl });
    }
  );

  // Start GitHub App creation
  app.post(
    "/start-creation",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (value) => {
      return schemaStartGitHubAppCreationRequest.parse(value);
    }),
    async (c) => {
      const agent = c.get("agent");
      const req = c.req.valid("json");
      const db = await c.env.database();

      // Get the agent's production deployment target for webhook URL
      const target = await db.selectAgentDeploymentTargetByName(
        agent.id,
        "production"
      );
      if (!target) {
        return c.json({ error: "No deployment target found" }, 400);
      }

      if (!c.env.accessUrl) {
        return c.json(
          { error: "Access URL not configured on this deployment" },
          500
        );
      }

      const webhookUrl = `${c.env.accessUrl.origin}/api/webhook/${target.request_id}/github`;
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_MS);

      // Build the callback URL - this is where GitHub will redirect after app creation
      const callbackUrl = `${c.env.accessUrl.origin}/api/agents/${agent.id}/setup/github/callback?session_id=${sessionId}`;

      // Create the manifest
      const manifest = createGitHubAppManifest(
        req.name,
        webhookUrl,
        callbackUrl
      );

      // Store setup state
      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          sessionId,
          manifestName: req.name,
          organization: req.organization,
          startedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          status: "pending",
        },
      });

      // Generate the manifest URL
      const manifestUrl = createGitHubManifestUrl(manifest, req.organization);

      const response: StartGitHubAppCreationResponse = {
        manifest_url: manifestUrl,
        session_id: sessionId,
      };
      return c.json(response);
    }
  );

  // GitHub callback - receives the code after app creation
  // This endpoint is PUBLIC (no auth) because GitHub redirects the user's browser here
  app.get("/callback", withAgentURLParam, async (c) => {
    const agent = c.get("agent");
    const db = await c.env.database();
    const sessionId = c.req.query("session_id");
    const code = c.req.query("code");

    // Validate session
    const setup = agent.github_app_setup;
    if (!setup || setup.sessionId !== sessionId) {
      return c.html(
        createCallbackHtml(
          "error",
          "Invalid or expired session. Please restart the GitHub App setup."
        )
      );
    }

    // Check expiry
    if (new Date() > new Date(setup.expiresAt)) {
      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          ...setup,
          status: "failed",
          error: "Session expired",
        },
      });
      return c.html(
        createCallbackHtml(
          "error",
          "Session expired. Please restart the GitHub App setup."
        )
      );
    }

    if (!code) {
      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          ...setup,
          status: "failed",
          error: "No code received from GitHub",
        },
      });
      return c.html(
        createCallbackHtml(
          "error",
          "No authorization code received from GitHub."
        )
      );
    }

    try {
      // Exchange the code for credentials
      const res = await fetch(
        `https://api.github.com/app-manifests/${code}/conversions`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "blink.so",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `GitHub API error: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ""}`
        );
      }

      const rawData = await res.json();
      const data = schemaGitHubAppData.parse(rawData);

      // Store the app data in the session
      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          ...setup,
          status: "completed",
          appData: {
            id: data.id,
            clientId: data.client_id,
            clientSecret: data.client_secret,
            webhookSecret: data.webhook_secret,
            pem: data.pem,
            name: data.name,
            htmlUrl: data.html_url,
            slug: data.slug,
          },
        },
      });

      return c.html(
        createCallbackHtml(
          "success",
          `GitHub App "${data.name}" created successfully! You can close this window and return to the setup wizard.`
        )
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          ...setup,
          status: "failed",
          error: errorMessage,
        },
      });

      return c.html(
        createCallbackHtml(
          "error",
          `Failed to create GitHub App: ${errorMessage}`
        )
      );
    }
  });

  // Get creation status
  app.get(
    "/creation-status/:session_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      const agent = c.get("agent");
      const sessionId = c.req.param("session_id");
      const setup = agent.github_app_setup;

      if (!setup || setup.sessionId !== sessionId) {
        return c.json({ status: "expired" as const });
      }

      // Check expiry
      if (setup.status === "pending" && new Date() > new Date(setup.expiresAt)) {
        return c.json({ status: "expired" as const });
      }

      const response: GitHubAppCreationStatusResponse = {
        status: setup.status,
        error: setup.error,
        app_data: setup.appData
          ? {
              id: setup.appData.id,
              name: setup.appData.name,
              html_url: setup.appData.htmlUrl,
              slug: setup.appData.slug,
            }
          : undefined,
      };
      return c.json(response);
    }
  );

  // Complete creation - save credentials as environment variables
  app.post(
    "/complete-creation",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (value) => {
      return schemaCompleteGitHubAppCreationRequest.parse(value);
    }),
    async (c) => {
      const agent = c.get("agent");
      const req = c.req.valid("json");
      const db = await c.env.database();
      const userId = c.get("user_id");

      const setup = agent.github_app_setup;
      if (!setup || setup.sessionId !== req.session_id) {
        throw new HTTPException(400, {
          message: "Invalid or expired session",
        });
      }

      if (setup.status !== "completed" || !setup.appData) {
        throw new HTTPException(400, {
          message: "GitHub App creation not completed",
        });
      }

      // Save credentials as environment variables
      const existingVars = await db.selectAgentEnvironmentVariablesByAgentID({
        agentID: agent.id,
      });

      const envVarsToSave = [
        {
          key: "GITHUB_APP_ID",
          value: String(setup.appData.id),
          secret: false,
        },
        {
          key: "GITHUB_CLIENT_ID",
          value: setup.appData.clientId,
          secret: false,
        },
        {
          key: "GITHUB_CLIENT_SECRET",
          value: setup.appData.clientSecret,
          secret: true,
        },
        {
          key: "GITHUB_WEBHOOK_SECRET",
          value: setup.appData.webhookSecret,
          secret: true,
        },
        {
          key: "GITHUB_PRIVATE_KEY",
          value: btoa(setup.appData.pem),
          secret: true,
        },
      ];

      for (const envVar of envVarsToSave) {
        const existing = existingVars.find((v) => v.key === envVar.key);
        if (existing) {
          await db.updateAgentEnvironmentVariable(existing.id, {
            value: envVar.value,
            secret: envVar.secret,
            updated_by: userId,
          });
        } else {
          await db.insertAgentEnvironmentVariable({
            agent_id: agent.id,
            key: envVar.key,
            value: envVar.value,
            secret: envVar.secret,
            target: ["preview", "production"],
            created_by: userId,
            updated_by: userId,
          });
        }
      }

      // Clear setup state
      await db.updateAgent({
        id: agent.id,
        github_app_setup: null,
      });

      const response: CompleteGitHubAppCreationResponse = {
        success: true,
        app_name: setup.appData.name,
        app_url: setup.appData.htmlUrl,
        install_url: `${setup.appData.htmlUrl}/installations/new`,
      };
      return c.json(response);
    }
  );

  // Cancel creation
  app.post(
    "/cancel-creation",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();

      // Clear setup state
      await db.updateAgent({
        id: agent.id,
        github_app_setup: null,
      });

      return c.body(null, 204);
    }
  );
}

/**
 * Create HTML page for the callback response.
 */
function createCallbackHtml(
  status: "success" | "error",
  message: string
): string {
  const isSuccess = status === "success";
  const bgColor = isSuccess ? "#10b981" : "#ef4444";
  const icon = isSuccess
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub App Setup - ${isSuccess ? "Success" : "Error"}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background-color: #0a0a0a;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 480px;
    }
    .icon {
      color: ${bgColor};
      margin-bottom: 24px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    p {
      color: #a1a1aa;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${isSuccess ? "Success!" : "Something went wrong"}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
