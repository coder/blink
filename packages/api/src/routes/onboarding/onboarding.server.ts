import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { authorizeOrganization, withAuth } from "../../middleware";
import type { Bindings } from "../../server";
import { createAgentDeployment } from "../agents/deployments.server";
import {
  schemaDeployAgentRequest,
  schemaDownloadAgentRequest,
  schemaValidateCredentialsRequest,
} from "./onboarding.client";

export default function mountOnboarding(app: Hono<{ Bindings: Bindings }>) {
  // Download the onboarding agent artifact from GitHub Releases
  app.post(
    "/download-agent",
    withAuth,
    validator("json", (value) => {
      return schemaDownloadAgentRequest.parse(value);
    }),
    async (c) => {
      const req = c.req.valid("json");
      await authorizeOrganization(c, req.organization_id);

      const releaseUrl = c.env.ONBOARDING_AGENT_RELEASE_URL;
      if (!releaseUrl) {
        throw new HTTPException(500, {
          message: "Onboarding agent release URL not configured",
        });
      }

      // Fetch release info from GitHub API
      const releaseResp = await fetch(releaseUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Blink-Server",
        },
      });
      if (!releaseResp.ok) {
        throw new HTTPException(502, {
          message: `Failed to fetch release info: ${releaseResp.status}`,
        });
      }

      const release = (await releaseResp.json()) as {
        tag_name?: string;
        assets?: Array<{
          name: string;
          browser_download_url: string;
        }>;
      };

      const agentAsset = release.assets?.find((a) => a.name === "agent.js");
      if (!agentAsset) {
        throw new HTTPException(404, {
          message: "Agent artifact not found in release",
        });
      }

      // Download the artifact
      const artifactResp = await fetch(agentAsset.browser_download_url, {
        headers: {
          "User-Agent": "Blink-Server",
        },
      });
      if (!artifactResp.ok) {
        throw new HTTPException(502, {
          message: `Failed to download artifact: ${artifactResp.status}`,
        });
      }

      const artifactData = await artifactResp.text();

      // Upload to file storage
      const { id } = await c.env.files.upload({
        user_id: c.get("user_id"),
        organization_id: req.organization_id,
        file: new File([artifactData], "agent.js", {
          type: "application/javascript",
        }),
      });

      return c.json({
        file_id: id,
        entrypoint: "agent.js",
        version: release.tag_name,
      });
    }
  );

  // Deploy the onboarding agent with provided configuration
  app.post(
    "/deploy-agent",
    withAuth,
    validator("json", (value) => {
      return schemaDeployAgentRequest.parse(value);
    }),
    async (c) => {
      const req = c.req.valid("json");
      const org = await authorizeOrganization(c, req.organization_id);
      const db = await c.env.database();

      const agent = await db.insertAgent({
        organization_id: org.id,
        created_by: c.get("user_id"),
        name: req.name,
        description:
          "AI agent with GitHub, Slack, web search, and compute capabilities",
        visibility: "organization",
      });

      // Grant admin permission to creator
      await db.upsertAgentPermission({
        agent_id: agent.id,
        user_id: agent.created_by,
        permission: "admin",
        created_by: agent.created_by,
      });

      // Insert environment variables
      for (const env of req.env) {
        await db.insertAgentEnvironmentVariable({
          agent_id: agent.id,
          key: env.key,
          value: env.value,
          secret: env.secret,
          target: ["preview", "production"],
          created_by: c.get("user_id"),
          updated_by: c.get("user_id"),
        });
      }

      // Create deployment with the downloaded file
      await createAgentDeployment({
        req: c.req.raw,
        db: db,
        bindings: c.env,
        outputFiles: [{ path: "agent.js", id: req.file_id }],
        entrypoint: "agent.js",
        agentID: agent.id,
        userID: c.get("user_id"),
        organizationID: org.id,
        target: "production",
      });

      return c.json({ id: agent.id, name: agent.name });
    }
  );

  // Validate integration credentials
  app.post(
    "/validate-credentials",
    withAuth,
    validator("json", (value) => {
      return schemaValidateCredentialsRequest.parse(value);
    }),
    async (c) => {
      const req = c.req.valid("json");

      if (req.type === "github") {
        try {
          const appId = req.credentials.appId as string | undefined;
          const privateKey = req.credentials.privateKey as string | undefined;
          if (!appId || !privateKey) {
            return c.json({
              valid: false,
              error: "App ID and Private Key are required",
            });
          }

          // Validate the private key format
          if (
            !privateKey.includes("-----BEGIN") ||
            !privateKey.includes("PRIVATE KEY-----")
          ) {
            return c.json({
              valid: false,
              error:
                "Private key must be in PEM format (-----BEGIN ... PRIVATE KEY-----)",
            });
          }

          // Validate app ID is numeric
          if (!/^\d+$/.test(appId)) {
            return c.json({
              valid: false,
              error: "App ID must be numeric",
            });
          }

          // Basic validation passed - full validation happens at runtime
          return c.json({ valid: true });
        } catch (error) {
          return c.json({
            valid: false,
            error:
              error instanceof Error
                ? error.message
                : "Invalid GitHub credentials",
          });
        }
      }

      if (req.type === "slack") {
        try {
          const botToken = req.credentials.botToken as string | undefined;
          if (!botToken) {
            return c.json({
              valid: false,
              error: "Bot Token is required",
            });
          }

          // Verify Slack bot token
          const resp = await fetch("https://slack.com/api/auth.test", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${botToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          });
          const data = (await resp.json()) as { ok: boolean; error?: string };
          if (!data.ok) {
            return c.json({
              valid: false,
              error: data.error || "Invalid Slack token",
            });
          }
          return c.json({ valid: true });
        } catch (error) {
          return c.json({
            valid: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to validate Slack token",
          });
        }
      }

      return c.json({ valid: false, error: "Unknown credential type" });
    }
  );
}
