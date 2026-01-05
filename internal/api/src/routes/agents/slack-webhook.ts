import { createHmac, timingSafeEqual } from "node:crypto";

import type { Bindings } from "../../server";
import type { AgentRequestRouting } from "../agent-request.server";

type SlackVerification = {
  signingSecret: string;
  botToken: string;
  startedAt: string;
  expiresAt: string;
  lastEventAt?: string;
  dmReceivedAt?: string;
  dmChannel?: string;
  signatureFailedAt?: string;
};

/**
 * Check if a request is for the Slack webhook path.
 */
export function isSlackRequest(
  routing: AgentRequestRouting,
  pathname: string
): boolean {
  return (
    (routing.mode === "webhook" && routing.subpath === "/slack") ||
    (routing.mode === "subdomain" && pathname === "/slack")
  );
}

function isSlackVerificationExpired(expiresAt: string): boolean {
  return Date.now() > new Date(expiresAt).getTime();
}

/**
 * Handle Slack webhook requests during verification flow.
 * Returns a Response if the request should be handled here, or null to continue to the agent.
 * When continuing to the agent, bodyText contains the already-read request body.
 */
export async function handleSlackWebhook(
  db: Awaited<ReturnType<Bindings["database"]>>,
  agent: { id: string; slack_verification: SlackVerification | null },
  request: Request,
  hasDeployment: boolean
): Promise<
  | { response: Response; bodyText?: undefined }
  | { response: null; bodyText?: string }
> {
  const slackVerification = agent.slack_verification;

  if (!slackVerification) {
    return { response: null };
  }

  // Check if verification has expired - if so, clear it and continue to agent
  if (isSlackVerificationExpired(slackVerification.expiresAt)) {
    await db.updateAgent({
      id: agent.id,
      slack_verification: null,
    });
    return { response: null };
  }

  // Read the body for verification processing
  const bodyText = await request.text();

  const result = await processSlackVerificationTracking(
    db,
    { id: agent.id, slack_verification: slackVerification },
    bodyText,
    request.headers.get("x-slack-signature") ?? undefined,
    request.headers.get("x-slack-request-timestamp") ?? undefined
  );

  // URL verification challenge must be responded to immediately
  if (result.challengeResponse) {
    return {
      response: Response.json({ challenge: result.challengeResponse }),
    };
  }

  // Invalid signature - acknowledge but don't process further
  if (!result.signatureValid) {
    return { response: Response.json({ ok: true }) };
  }

  // No deployment - we've tracked the event, just acknowledge
  if (!hasDeployment) {
    return { response: Response.json({ ok: true }) };
  }

  // Continue to forward to agent
  return { response: null, bodyText };
}

/**
 * Verify Slack request signature using HMAC-SHA256.
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const time = Math.floor(Date.now() / 1000);
  const requestTimestamp = Number.parseInt(timestamp, 10);

  // Request is older than 5 minutes - reject to prevent replay attacks
  if (Math.abs(time - requestTimestamp) > 60 * 5) {
    return false;
  }

  const hmac = createHmac("sha256", signingSecret);
  const sigBasestring = `v0:${timestamp}:${body}`;
  hmac.update(sigBasestring);
  const mySignature = `v0=${hmac.digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Process Slack verification tracking without blocking the request flow.
 * Returns tracking results so the caller can decide how to proceed.
 */
async function processSlackVerificationTracking(
  db: Awaited<ReturnType<Bindings["database"]>>,
  agent: {
    id: string;
    slack_verification: SlackVerification;
  },
  body: string,
  slackSignature: string | undefined,
  slackTimestamp: string | undefined
): Promise<{
  signatureValid: boolean;
  challengeResponse?: string;
}> {
  const verification = agent.slack_verification;

  // Verify Slack signature if headers are present
  if (slackSignature && slackTimestamp) {
    if (
      !verifySlackSignature(
        verification.signingSecret,
        slackTimestamp,
        body,
        slackSignature
      )
    ) {
      // Signature verification failed - record in database
      await db.updateAgent({
        id: agent.id,
        slack_verification: {
          ...verification,
          signatureFailedAt: new Date().toISOString(),
        },
      });
      return { signatureValid: false };
    }
  }

  // Parse the payload
  let payload: {
    type?: string;
    challenge?: string;
    event?: {
      type?: string;
      channel_type?: string;
      channel?: string;
      bot_id?: string;
      ts?: string;
    };
  };

  try {
    payload = JSON.parse(body);
  } catch {
    // Can't parse - treat as invalid but not a security issue
    return { signatureValid: true };
  }

  // Handle Slack URL verification challenge
  if (payload.type === "url_verification" && payload.challenge) {
    // Update lastEventAt since we received a valid event
    await db.updateAgent({
      id: agent.id,
      slack_verification: {
        ...verification,
        lastEventAt: new Date().toISOString(),
      },
    });
    return { signatureValid: true, challengeResponse: payload.challenge };
  }

  // Track if we received a DM
  const isDM =
    payload.event?.type === "message" &&
    payload.event.channel_type === "im" &&
    !payload.event.bot_id; // Ignore bot's own messages

  // If this is a DM and we haven't already recorded one, send a response to Slack
  if (isDM && !verification.dmReceivedAt && payload.event?.channel) {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${verification.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: payload.event.channel,
        thread_ts: payload.event.ts,
        text: "Congrats, your Slack app is set up! You can now go back to the Blink dashboard.",
      }),
    }).catch(() => {
      // Silent fail - user will see status in the UI
    });
  }

  const updatedVerification = {
    ...verification,
    lastEventAt: new Date().toISOString(),
    ...(isDM && {
      dmReceivedAt: new Date().toISOString(),
      dmChannel: payload.event?.channel,
    }),
  };

  await db.updateAgent({
    id: agent.id,
    slack_verification: updatedVerification,
  });

  // Continue to agent - we've tracked the event
  return { signatureValid: true };
}
