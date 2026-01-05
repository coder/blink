import { z } from "zod";
import type Client from "../../client.browser";
import { assertResponseStatus } from "../../client-helper";

// Slack verification state stored on agent
export const schemaSlackVerification = z
  .object({
    signingSecret: z.string(),
    botToken: z.string(),
    startedAt: z.string(),
    lastEventAt: z.string().optional(),
    dmReceivedAt: z.string().optional(),
    dmChannel: z.string().optional(),
    signatureFailedAt: z.string().optional(),
  })
  .nullable();

export type SlackVerification = z.infer<typeof schemaSlackVerification>;

// Start verification request/response
export const schemaStartSlackVerificationRequest = z.object({
  signing_secret: z.string().min(1),
  bot_token: z.string().min(1),
});

export type StartSlackVerificationRequest = z.infer<
  typeof schemaStartSlackVerificationRequest
>;

export const schemaStartSlackVerificationResponse = z.object({
  webhook_url: z.string(),
});

export type StartSlackVerificationResponse = z.infer<
  typeof schemaStartSlackVerificationResponse
>;

// Verification status response
export const schemaSlackVerificationStatusResponse = z.object({
  active: z.boolean(),
  started_at: z.string().optional(),
  last_event_at: z.string().optional(),
  dm_received: z.boolean(),
  dm_channel: z.string().optional(),
  signature_failed: z.boolean(),
  signature_failed_at: z.string().optional(),
});

export type SlackVerificationStatusResponse = z.infer<
  typeof schemaSlackVerificationStatusResponse
>;

// Complete verification request
export const schemaCompleteSlackVerificationRequest = z.object({
  bot_token: z.string().min(1),
  signing_secret: z.string().min(1),
});

export type CompleteSlackVerificationRequest = z.infer<
  typeof schemaCompleteSlackVerificationRequest
>;

export const schemaCompleteSlackVerificationResponse = z.object({
  success: z.boolean(),
  bot_name: z.string().optional(),
});

export type CompleteSlackVerificationResponse = z.infer<
  typeof schemaCompleteSlackVerificationResponse
>;

// Webhook URL response
export const schemaSlackWebhookUrlResponse = z.object({
  webhook_url: z.string(),
});

export type SlackWebhookUrlResponse = z.infer<
  typeof schemaSlackWebhookUrlResponse
>;

// Validate token request/response
export const schemaValidateSlackTokenRequest = z.object({
  botToken: z.string(),
});

export type ValidateSlackTokenRequest = z.infer<
  typeof schemaValidateSlackTokenRequest
>;

export const schemaValidateSlackTokenResponse = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
});

export type ValidateSlackTokenResponse = z.infer<
  typeof schemaValidateSlackTokenResponse
>;

export default class AgentSetupSlack {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Get the webhook URL for Slack integration.
   * This doesn't require any credentials and can be called before setup.
   */
  public async getWebhookUrl(
    agentId: string
  ): Promise<SlackWebhookUrlResponse> {
    const resp = await this.client.request(
      "GET",
      `/api/agents/${agentId}/setup/slack/webhook-url`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Validate a Slack bot token by calling Slack's auth.test API.
   */
  public async validateToken(
    agentId: string,
    request: ValidateSlackTokenRequest
  ): Promise<ValidateSlackTokenResponse> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/slack/validate-token`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Start Slack verification for an agent.
   * This sets up the webhook to listen for Slack events.
   */
  public async startVerification(
    agentId: string,
    request: StartSlackVerificationRequest
  ): Promise<StartSlackVerificationResponse> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/slack/start-verification`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Get the current verification status.
   */
  public async getVerificationStatus(
    agentId: string
  ): Promise<SlackVerificationStatusResponse> {
    const resp = await this.client.request(
      "GET",
      `/api/agents/${agentId}/setup/slack/verification-status`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Complete Slack verification and save credentials.
   */
  public async completeVerification(
    agentId: string,
    request: CompleteSlackVerificationRequest
  ): Promise<CompleteSlackVerificationResponse> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/slack/complete-verification`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Cancel ongoing Slack verification.
   */
  public async cancelVerification(agentId: string): Promise<void> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/slack/cancel-verification`
    );
    await assertResponseStatus(resp, 204);
  }
}
