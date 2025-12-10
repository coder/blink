import { Hono } from "hono";
import { validator } from "hono/validator";

import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
} from "../../middleware";
import type { Bindings } from "../../server";
import {
  schemaCompleteSlackVerificationRequest,
  schemaStartSlackVerificationRequest,
  type CompleteSlackVerificationResponse,
  type SlackVerificationStatusResponse,
  type StartSlackVerificationResponse,
} from "./setup-slack.client";

/**
 * Verify Slack bot token by calling auth.test API.
 */
async function verifySlackBotToken(
  botToken: string
): Promise<{ valid: boolean; error?: string; botName?: string }> {
  try {
    const resp = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const data = (await resp.json()) as {
      ok: boolean;
      error?: string;
      user?: string;
      bot_id?: string;
    };
    if (!data.ok) {
      return { valid: false, error: data.error || "Invalid token" };
    }
    return { valid: true, botName: data.user };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

export default function mountSetupSlack(
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
      const webhookUrl = `${c.env.accessUrl.origin}/api/webhook/${target.request_id}/slack`;

      return c.json({ webhook_url: webhookUrl });
    }
  );

  // Start Slack verification
  app.post(
    "/start-verification",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (value) => {
      return schemaStartSlackVerificationRequest.parse(value);
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

      // Generate webhook URL using the access URL
      if (!c.env.accessUrl) {
        return c.json(
          { error: "Access URL not configured on this deployment" },
          500
        );
      }
      const webhookUrl = `${c.env.accessUrl.origin}/api/webhook/${target.request_id}/slack`;

      // Store verification state
      await db.updateAgent({
        id: agent.id,
        slack_verification: {
          signingSecret: req.signing_secret,
          botToken: req.bot_token,
          startedAt: new Date().toISOString(),
        },
      });

      const response: StartSlackVerificationResponse = {
        webhook_url: webhookUrl,
      };
      return c.json(response);
    }
  );

  // Get verification status
  app.get(
    "/verification-status",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      const agent = c.get("agent");
      const verification = agent.slack_verification;

      const response: SlackVerificationStatusResponse = {
        active: verification !== null,
        started_at: verification?.startedAt,
        last_event_at: verification?.lastEventAt,
        dm_received: verification?.dmReceivedAt !== undefined,
        dm_channel: verification?.dmChannel,
        signature_failed: verification?.signatureFailedAt !== undefined,
        signature_failed_at: verification?.signatureFailedAt,
      };
      return c.json(response);
    }
  );

  // Complete verification
  app.post(
    "/complete-verification",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (value) => {
      return schemaCompleteSlackVerificationRequest.parse(value);
    }),
    async (c) => {
      const agent = c.get("agent");
      const req = c.req.valid("json");
      const db = await c.env.database();
      const userId = c.get("user_id");

      // Verify the bot token
      const verification = await verifySlackBotToken(req.bot_token);
      if (!verification.valid) {
        return c.json(
          { success: false, error: verification.error },
          400
        );
      }

      // Save credentials as environment variables
      // First check if they already exist and update, otherwise create
      const existingVars = await db.selectAgentEnvironmentVariablesByAgentID({
        agentID: agent.id,
      });

      const botTokenVar = existingVars.find(
        (v) => v.key === "SLACK_BOT_TOKEN"
      );
      const signingSecretVar = existingVars.find(
        (v) => v.key === "SLACK_SIGNING_SECRET"
      );

      if (botTokenVar) {
        await db.updateAgentEnvironmentVariable(botTokenVar.id, {
          value: req.bot_token,
          secret: true,
          updated_by: userId,
        });
      } else {
        await db.insertAgentEnvironmentVariable({
          agent_id: agent.id,
          key: "SLACK_BOT_TOKEN",
          value: req.bot_token,
          secret: true,
          target: ["preview", "production"],
          created_by: userId,
          updated_by: userId,
        });
      }

      if (signingSecretVar) {
        await db.updateAgentEnvironmentVariable(signingSecretVar.id, {
          value: req.signing_secret,
          secret: true,
          updated_by: userId,
        });
      } else {
        await db.insertAgentEnvironmentVariable({
          agent_id: agent.id,
          key: "SLACK_SIGNING_SECRET",
          value: req.signing_secret,
          secret: true,
          target: ["preview", "production"],
          created_by: userId,
          updated_by: userId,
        });
      }

      // Clear verification state
      await db.updateAgent({
        id: agent.id,
        slack_verification: null,
      });

      const response: CompleteSlackVerificationResponse = {
        success: true,
        bot_name: verification.botName,
      };
      return c.json(response);
    }
  );

  // Cancel verification
  app.post(
    "/cancel-verification",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();

      // Clear verification state
      await db.updateAgent({
        id: agent.id,
        slack_verification: null,
      });

      return c.body(null, 204);
    }
  );
}
