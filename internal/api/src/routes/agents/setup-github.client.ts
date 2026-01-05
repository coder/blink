import { z } from "zod";
import type Client from "../../client.browser";
import { assertResponseStatus } from "../../client-helper";

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
  manifest: z.string(),
  github_url: z.string(),
  session_id: z.string(),
});

export type StartGitHubAppCreationResponse = z.infer<
  typeof schemaStartGitHubAppCreationResponse
>;

// GitHub credentials returned when status is completed
// These should be saved as env vars by the client
export const schemaGitHubAppCredentials = z.object({
  app_id: z.number(),
  client_id: z.string(),
  client_secret: z.string(),
  webhook_secret: z.string(),
  private_key: z.string(), // base64-encoded PEM
});

export type GitHubAppCredentials = z.infer<typeof schemaGitHubAppCredentials>;

// Creation status response
// Status flow: pending -> app_created -> completed
// - pending: waiting for user to create app on GitHub
// - app_created: app created, waiting for user to install it
// - completed: app created and installed
// - failed/expired: error states
export const schemaGitHubAppCreationStatusResponse = z.object({
  status: z.enum(["pending", "app_created", "completed", "failed", "expired"]),
  error: z.string().optional(),
  app_data: z
    .object({
      id: z.number(),
      name: z.string(),
      html_url: z.string(),
      slug: z.string(),
    })
    .optional(),
  // Credentials are only included when status is "completed"
  credentials: schemaGitHubAppCredentials.optional(),
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

export default class AgentSetupGitHub {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
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
   * Complete GitHub App creation.
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
}
