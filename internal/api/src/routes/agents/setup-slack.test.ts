import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { HttpResponse, http } from "msw";
import { type SetupServerApi, setupServer } from "msw/node";
import type Client from "../../client.node";
import { serve as originalServe } from "../../test";

const serve = () => {
  return originalServe({
    bindings: {
      accessUrl: new URL("https://test.blink.so"),
      matchRequestHost: undefined,
      createRequestURL: undefined,
    },
  });
};

type ServeResult = Awaited<ReturnType<typeof serve>>;

/**
 * Compute a valid Slack signature for testing.
 */
function computeSlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string
): string {
  const hmac = createHmac("sha256", signingSecret);
  const sigBasestring = `v0:${timestamp}:${body}`;
  hmac.update(sigBasestring);
  return `v0=${hmac.digest("hex")}`;
}

/**
 * Helper to create test fixtures (user, org, agent).
 */
async function setupAgent(helpers: ServeResult["helpers"]) {
  const { client } = await helpers.createUser();
  const org = await client.organizations.create({ name: "test-org" });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });
  return { client, org, agent };
}

/**
 * Helper to send a Slack webhook request with proper signature.
 */
async function sendSlackWebhook(
  baseUrl: string,
  webhookPath: string,
  signingSecret: string,
  payload: object
) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = computeSlackSignature(signingSecret, timestamp, body);

  return fetch(`${baseUrl}${webhookPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    },
    body,
  });
}

/**
 * Helper to start verification and get webhook path.
 */
async function startVerificationAndGetWebhookPath(
  client: Client,
  agentId: string,
  signingSecret: string,
  botToken = "xoxb-test-bot-token"
) {
  const result = await client.agents.setupSlack.startVerification(agentId, {
    signing_secret: signingSecret,
    bot_token: botToken,
  });
  const webhookPath = new URL(result.webhook_url).pathname;
  return { webhookUrl: result.webhook_url, webhookPath };
}

/**
 * Helper to mock Slack auth.test API response.
 */
function mockSlackAuthTest(
  mswServer: SetupServerApi,
  response: { ok: boolean; user?: string; bot_id?: string; error?: string }
) {
  mswServer.use(
    http.post("https://slack.com/api/auth.test", () => {
      return HttpResponse.json(response);
    })
  );
}

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

describe("Slack Setup", () => {
  describe("GET /webhook-url", () => {
    test("returns webhook URL when deployment target exists", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      const result = await client.agents.setupSlack.getWebhookUrl(agent.id);

      expect(result.webhook_url).toMatch(
        /^https:\/\/test\.blink\.so\/api\/webhook\/[a-z0-9-]+\/slack$/
      );
    });
  });

  describe("POST /start-verification", () => {
    test("stores verification state and returns webhook URL", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      const result = await client.agents.setupSlack.startVerification(
        agent.id,
        { signing_secret: "test-signing-secret", bot_token: "xoxb-test-token" }
      );

      expect(result.webhook_url).toMatch(
        /^https:\/\/test\.blink\.so\/api\/webhook\/[a-z0-9-]+\/slack$/
      );

      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);
      expect(status.started_at).toBeDefined();
    });
  });

  describe("GET /verification-status", () => {
    test("returns active: false when no verification in progress", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );

      expect(status.active).toBe(false);
      expect(status.started_at).toBeUndefined();
      expect(status.dm_received).toBe(false);
      expect(status.signature_failed).toBe(false);
    });

    test("returns correct status fields when verification active", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      await client.agents.setupSlack.startVerification(agent.id, {
        signing_secret: "test-signing-secret",
        bot_token: "xoxb-test-bot-token",
      });

      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );

      expect(status.active).toBe(true);
      expect(status.started_at).toBeDefined();
      expect(status.dm_received).toBe(false);
      expect(status.signature_failed).toBe(false);
    });
  });

  describe("POST /complete-verification", () => {
    test("verifies token and returns bot name", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      mockSlackAuthTest(mswServer, {
        ok: true,
        user: "test-bot",
        bot_id: "B123",
      });

      const result = await client.agents.setupSlack.completeVerification(
        agent.id,
        {
          bot_token: "xoxb-test-bot-token",
          signing_secret: "test-signing-secret",
        }
      );

      expect(result.success).toBe(true);
      expect(result.bot_name).toBe("test-bot");
    });

    test("returns 400 when bot token verification fails", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      mockSlackAuthTest(mswServer, { ok: false, error: "invalid_auth" });

      await expect(
        client.agents.setupSlack.completeVerification(agent.id, {
          bot_token: "xoxb-invalid-token",
          signing_secret: "test-signing-secret",
        })
      ).rejects.toThrow();
    });

    test("clears verification state after completion", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      await client.agents.setupSlack.startVerification(agent.id, {
        signing_secret: "test-signing-secret",
        bot_token: "xoxb-test-bot-token",
      });

      let status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);

      mockSlackAuthTest(mswServer, {
        ok: true,
        user: "test-bot",
        bot_id: "B123",
      });

      await client.agents.setupSlack.completeVerification(agent.id, {
        bot_token: "xoxb-test-bot-token",
        signing_secret: "test-signing-secret",
      });

      status = await client.agents.setupSlack.getVerificationStatus(agent.id);
      expect(status.active).toBe(false);
    });
  });

  describe("POST /cancel-verification", () => {
    test("clears verification state and returns 204", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      await client.agents.setupSlack.startVerification(agent.id, {
        signing_secret: "test-signing-secret",
        bot_token: "xoxb-test-bot-token",
      });

      let status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);

      await client.agents.setupSlack.cancelVerification(agent.id);

      status = await client.agents.setupSlack.getVerificationStatus(agent.id);
      expect(status.active).toBe(false);
    });
  });

  describe("integration flow", () => {
    test("full workflow: start -> poll status -> complete", async () => {
      const { helpers } = await serve();
      const { client, agent } = await setupAgent(helpers);

      // Step 1: Get webhook URL
      const webhookResult = await client.agents.setupSlack.getWebhookUrl(
        agent.id
      );
      expect(webhookResult.webhook_url).toBeDefined();

      // Step 2: Start verification
      const startResult = await client.agents.setupSlack.startVerification(
        agent.id,
        { signing_secret: "test-signing-secret", bot_token: "xoxb-test-token" }
      );
      expect(startResult.webhook_url).toBe(webhookResult.webhook_url);

      // Step 3: Poll status (verification should be active)
      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);
      expect(status.dm_received).toBe(false);

      // Step 4: Complete verification
      mockSlackAuthTest(mswServer, {
        ok: true,
        user: "integration-test-bot",
        bot_id: "B789",
      });

      const completeResult =
        await client.agents.setupSlack.completeVerification(agent.id, {
          bot_token: "xoxb-test-token",
          signing_secret: "test-signing-secret",
        });
      expect(completeResult.success).toBe(true);
      expect(completeResult.bot_name).toBe("integration-test-bot");

      const finalStatus = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(finalStatus.active).toBe(false);
    });
  });

  describe("Slack webhook during verification", () => {
    test("handles URL verification challenge", async () => {
      const { helpers, url } = await serve();
      const { client, agent } = await setupAgent(helpers);
      const signingSecret = "test-signing-secret-for-webhook";

      const { webhookPath } = await startVerificationAndGetWebhookPath(
        client,
        agent.id,
        signingSecret
      );

      const response = await sendSlackWebhook(
        url.toString(),
        webhookPath,
        signingSecret,
        {
          type: "url_verification",
          challenge: "test-challenge-token-12345",
        }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        challenge: "test-challenge-token-12345",
      });

      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);
      expect(status.last_event_at).toBeDefined();
    });

    test("tracks DM receipt and updates verification status", async () => {
      const { helpers, url } = await serve();
      const { client, agent } = await setupAgent(helpers);
      const signingSecret = "test-signing-secret-for-dm";

      // Mock the chat.postMessage endpoint (for the congratulations message)
      mswServer.use(
        http.post("https://slack.com/api/chat.postMessage", () => {
          return HttpResponse.json({ ok: true });
        })
      );

      const { webhookPath } = await startVerificationAndGetWebhookPath(
        client,
        agent.id,
        signingSecret
      );

      const response = await sendSlackWebhook(
        url.toString(),
        webhookPath,
        signingSecret,
        {
          type: "event_callback",
          event: {
            type: "message",
            channel_type: "im",
            channel: "D12345678",
            user: "U12345678",
            text: "Hello bot!",
            ts: "1234567890.123456",
          },
        }
      );

      expect(response.status).toBe(200);

      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);
      expect(status.dm_received).toBe(true);
      expect(status.dm_channel).toBe("D12345678");
      expect(status.last_event_at).toBeDefined();
    });

    test("tracks signature failure when signature is invalid", async () => {
      const { helpers, url } = await serve();
      const { client, agent } = await setupAgent(helpers);

      const { webhookPath } = await startVerificationAndGetWebhookPath(
        client,
        agent.id,
        "correct-signing-secret"
      );

      // Send with WRONG signing secret
      const response = await sendSlackWebhook(
        url.toString(),
        webhookPath,
        "wrong-signing-secret",
        {
          type: "event_callback",
          event: { type: "message", channel_type: "im", channel: "D12345678" },
        }
      );

      expect(response.status).toBe(200);

      const status = await client.agents.setupSlack.getVerificationStatus(
        agent.id
      );
      expect(status.active).toBe(true);
      expect(status.signature_failed).toBe(true);
      expect(status.signature_failed_at).toBeDefined();
    });

    test("sends congratulations message on first DM", async () => {
      const { helpers, url } = await serve();
      const { client, agent } = await setupAgent(helpers);
      const signingSecret = "test-signing-secret-congrats";

      // Track the chat.postMessage call
      let postMessageCalled = false;
      let postMessageBody: unknown = null;
      mswServer.use(
        http.post(
          "https://slack.com/api/chat.postMessage",
          async ({ request }) => {
            postMessageCalled = true;
            postMessageBody = await request.json();
            return HttpResponse.json({ ok: true });
          }
        )
      );

      const { webhookPath } = await startVerificationAndGetWebhookPath(
        client,
        agent.id,
        signingSecret
      );

      await sendSlackWebhook(url.toString(), webhookPath, signingSecret, {
        type: "event_callback",
        event: {
          type: "message",
          channel_type: "im",
          channel: "D99999999",
          user: "U12345678",
          text: "Test message",
          ts: "1234567890.999999",
        },
      });

      expect(postMessageCalled).toBe(true);
      expect(postMessageBody).toMatchObject({
        channel: "D99999999",
        thread_ts: "1234567890.999999",
      });
    });
  });
});
