import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";

import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
} from "../../middleware";
import type { Bindings } from "../../server";
import { createWebhookURL } from "../../server-helper";
import {
  type CompleteGitHubAppCreationResponse,
  type GitHubAppCreationStatusResponse,
  type StartGitHubAppCreationResponse,
  schemaCompleteGitHubAppCreationRequest,
  schemaGitHubAppData,
  schemaStartGitHubAppCreationRequest,
} from "./setup-github.client";

// 24 hour expiry for GitHub App creation sessions
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Create the GitHub App manifest for the manifest flow.
 */
function createGitHubAppManifest(
  name: string,
  webhookUrl: string,
  callbackUrl: string,
  setupUrl: string
) {
  return {
    name,
    url: "https://github.com/coder/blink",
    description: "A Blink agent for GitHub",
    public: false,
    redirect_url: callbackUrl,
    setup_url: setupUrl,
    setup_on_update: true,
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

export default function mountSetupGitHub(
  app: Hono<{
    Bindings: Bindings;
  }>
) {
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

      const webhookUrl = createWebhookURL(c.env, target.request_id, "github");
      const sessionId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_MS);

      const apiOrigin = c.env.accessUrl.origin;
      // Build the callback URL - this is where GitHub will redirect after app creation
      const callbackUrl = `${apiOrigin}/api/agents/${agent.id}/setup/github/callback?session_id=${sessionId}`;
      // Build the setup URL - this is where GitHub will redirect after app installation
      const setupUrl = `${apiOrigin}/api/agents/${agent.id}/setup/github/setup-complete?session_id=${sessionId}`;

      const manifest = createGitHubAppManifest(
        req.name,
        webhookUrl,
        callbackUrl,
        setupUrl
      );

      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          sessionId,
          startedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          status: "pending",
        },
      });

      // Return the manifest and GitHub URL for the frontend to submit
      const githubUrl = req.organization
        ? `https://github.com/organizations/${req.organization}/settings/apps/new`
        : `https://github.com/settings/apps/new`;

      const response: StartGitHubAppCreationResponse = {
        manifest: JSON.stringify(manifest),
        github_url: githubUrl,
        session_id: sessionId,
      };
      return c.json(response);
    }
  );

  // GitHub callback - receives the code after app creation
  // This endpoint is PUBLIC (no auth) because GitHub redirects the user's browser here
  // Security is provided by validating the session_id
  app.get("/callback", async (c) => {
    const agentId = c.req.param("agent_id");
    if (!agentId) {
      return c.html(createCallbackHtml("error", "Agent ID is required"));
    }

    const db = await c.env.database();
    const agent = await db.selectAgentByID(agentId);
    if (!agent) {
      return c.html(createCallbackHtml("error", "Agent not found"));
    }

    const sessionId = c.req.query("session_id");
    const code = c.req.query("code");

    // Validate session - this provides security for this public endpoint
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
            "User-Agent": `Blink-Server/${c.env.serverVersion}`,
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

      // Store the app data in the session (status stays "pending" until installation)
      await db.updateAgent({
        id: agent.id,
        github_app_setup: {
          ...setup,
          status: "app_created",
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

      // Redirect to the app's installation page
      const installUrl = `${data.html_url}/installations/new`;
      return c.redirect(installUrl);
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

  // Setup complete - this is the Setup URL that GitHub redirects to after app installation
  // This endpoint is PUBLIC (no auth) because GitHub redirects the user's browser here
  app.get("/setup-complete", async (c) => {
    const agentId = c.req.param("agent_id");
    if (!agentId) {
      return c.html(
        createCallbackHtml("error", "Agent ID is required", undefined)
      );
    }

    const db = await c.env.database();
    const agent = await db.selectAgentByID(agentId);
    if (!agent) {
      return c.html(createCallbackHtml("error", "Agent not found", undefined));
    }

    const sessionId = c.req.query("session_id");
    const installationId = c.req.query("installation_id");
    const setup = agent.github_app_setup;

    // Check if there's an active setup session
    const hasActiveSession = setup && setup.sessionId === sessionId;

    if (hasActiveSession && setup.appData) {
      // Update the setup with installation info if provided
      if (installationId) {
        await db.updateAgent({
          id: agent.id,
          github_app_setup: {
            ...setup,
            status: "completed",
            installationId,
          },
        });
      } else if (setup.status === "app_created") {
        // Mark as completed even without installation_id (user might have installed)
        await db.updateAgent({
          id: agent.id,
          github_app_setup: {
            ...setup,
            status: "completed",
          },
        });
      }

      return c.html(
        createCallbackHtml(
          "success",
          `GitHub App "${setup.appData.name}" has been installed! Return to the setup wizard to continue.`,
          true
        )
      );
    }

    // No active session - just show a generic success message
    return c.html(
      createCallbackHtml("success", "GitHub App installation complete!", false)
    );
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

      // Check expiry for pending states
      if (
        (setup.status === "pending" || setup.status === "app_created") &&
        new Date() > new Date(setup.expiresAt)
      ) {
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
        // Include full credentials only when status is completed
        // so the client can save them as env vars
        credentials:
          setup.status === "completed" && setup.appData
            ? {
                app_id: setup.appData.id,
                client_id: setup.appData.clientId,
                client_secret: setup.appData.clientSecret,
                webhook_secret: setup.appData.webhookSecret,
                private_key: btoa(setup.appData.pem),
              }
            : undefined,
      };
      return c.json(response);
    }
  );

  // Complete creation - clear setup state
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
}

/**
 * Create HTML page for the callback response.
 * @param showWizardHint - If true, shows a hint to return to the setup wizard
 */
function createCallbackHtml(
  status: "success" | "error",
  message: string,
  showWizardHint?: boolean
): string {
  const isSuccess = status === "success";
  const bgColor = isSuccess ? "#10b981" : "#ef4444";
  const icon = isSuccess
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;

  const wizardHint = showWizardHint
    ? `<p class="hint">You can close this window and return to the setup wizard.</p>`
    : "";

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
    .hint {
      margin-top: 16px;
      font-size: 14px;
      color: #71717a;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${isSuccess ? "Success!" : "Something went wrong"}</h1>
    <p>${message}</p>
    ${wizardHint}
  </div>
</body>
</html>`;
}
