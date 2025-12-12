import { z } from "zod";

import { assertResponseStatus } from "../../client-helper";
import type Client from "../../client.browser";

// GitHub App data returned from GitHub after creation
export const schemaGitHubAppData = z.object({
  id: z.number(),
  client_id: z.string(),
  client_secret: z.string(),
  webhook_secret: z.string(),
  pem: z.string(),
  name: z.string(),
  html_url: z.string(),
  slug: z.string(),
});

export type GitHubAppData = z.infer<typeof schemaGitHubAppData>;

// Start creation request/response
export const schemaStartGitHubAppCreationRequest = z.object({
  name: z.string().min(1).max(34),
  organization: z.string().optional(),
});

export type StartGitHubAppCreationRequest = z.infer<
  typeof schemaStartGitHubAppCreationRequest
>;

export const schemaStartGitHubAppCreationResponse = z.object({
  manifest_url: z.string(),
  session_id: z.string(),
});

export type StartGitHubAppCreationResponse = z.infer<
  typeof schemaStartGitHubAppCreationResponse
>;

// Creation status response
export const schemaGitHubAppCreationStatusResponse = z.object({
  status: z.enum(["pending", "completed", "failed", "expired"]),
  error: z.string().optional(),
  app_data: z
    .object({
      id: z.number(),
      name: z.string(),
      html_url: z.string(),
      slug: z.string(),
    })
    .optional(),
});

export type GitHubAppCreationStatusResponse = z.infer<
  typeof schemaGitHubAppCreationStatusResponse
>;

// Complete creation request
export const schemaCompleteGitHubAppCreationRequest = z.object({
  session_id: z.string(),
});

export type CompleteGitHubAppCreationRequest = z.infer<
  typeof schemaCompleteGitHubAppCreationRequest
>;

export const schemaCompleteGitHubAppCreationResponse = z.object({
  success: z.boolean(),
  app_name: z.string().optional(),
  app_url: z.string().optional(),
  install_url: z.string().optional(),
});

export type CompleteGitHubAppCreationResponse = z.infer<
  typeof schemaCompleteGitHubAppCreationResponse
>;

// Webhook URL response
export const schemaGitHubWebhookUrlResponse = z.object({
  webhook_url: z.string(),
});

export type GitHubWebhookUrlResponse = z.infer<
  typeof schemaGitHubWebhookUrlResponse
>;

export default class AgentSetupGitHub {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Get the webhook URL for GitHub integration.
   * This doesn't require any credentials and can be called before setup.
   */
  public async getWebhookUrl(agentId: string): Promise<GitHubWebhookUrlResponse> {
    const resp = await this.client.request(
      "GET",
      `/api/agents/${agentId}/setup/github/webhook-url`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Start GitHub App creation for an agent.
   * Returns a URL to redirect the user to GitHub for app creation.
   */
  public async startCreation(
    agentId: string,
    request: StartGitHubAppCreationRequest
  ): Promise<StartGitHubAppCreationResponse> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/github/start-creation`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Get the current creation status.
   * Poll this endpoint to check if the GitHub callback has been received.
   */
  public async getCreationStatus(
    agentId: string,
    sessionId: string
  ): Promise<GitHubAppCreationStatusResponse> {
    const resp = await this.client.request(
      "GET",
      `/api/agents/${agentId}/setup/github/creation-status/${sessionId}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Complete GitHub App creation and save credentials.
   * Call this after the status shows "completed" to persist the credentials.
   */
  public async completeCreation(
    agentId: string,
    request: CompleteGitHubAppCreationRequest
  ): Promise<CompleteGitHubAppCreationResponse> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/github/complete-creation`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Cancel ongoing GitHub App creation.
   */
  public async cancelCreation(agentId: string): Promise<void> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${agentId}/setup/github/cancel-creation`
    );
    await assertResponseStatus(resp, 204);
  }
}
