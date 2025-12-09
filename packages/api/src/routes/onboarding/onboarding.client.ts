import { z } from "zod";
import { assertResponseStatus } from "../../client-helper";
import type Client from "../../client.browser";

export const schemaDownloadAgentRequest = z.object({
  organization_id: z.string().uuid(),
});

export type DownloadAgentRequest = z.infer<typeof schemaDownloadAgentRequest>;

export const schemaDownloadAgentResponse = z.object({
  file_id: z.string().uuid(),
  entrypoint: z.string(),
  version: z.string().optional(),
});

export type DownloadAgentResponse = z.infer<typeof schemaDownloadAgentResponse>;

export const schemaDeployAgentRequest = z.object({
  organization_id: z.string().uuid(),
  name: z.string().min(1).max(40),
  file_id: z.string().uuid(),
  env: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      secret: z.boolean(),
    })
  ),
});

export type DeployAgentRequest = z.infer<typeof schemaDeployAgentRequest>;

export const schemaDeployAgentResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export type DeployAgentResponse = z.infer<typeof schemaDeployAgentResponse>;

export const schemaValidateCredentialsRequest = z.object({
  type: z.enum(["github", "slack"]),
  credentials: z.record(z.string(), z.string()),
});

export type ValidateCredentialsRequest = z.infer<
  typeof schemaValidateCredentialsRequest
>;

export const schemaValidateCredentialsResponse = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
});

export type ValidateCredentialsResponse = z.infer<
  typeof schemaValidateCredentialsResponse
>;

export default class Onboarding {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Download the pre-built onboarding agent from GitHub Releases.
   *
   * @param request - The request body containing organization_id.
   * @returns The file ID and entrypoint of the downloaded agent.
   */
  public async downloadAgent(
    request: DownloadAgentRequest
  ): Promise<DownloadAgentResponse> {
    const resp = await this.client.request(
      "POST",
      "/api/onboarding/download-agent",
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Deploy the onboarding agent with the provided configuration.
   *
   * @param request - The deployment configuration.
   * @returns The created agent's ID and name.
   */
  public async deployAgent(
    request: DeployAgentRequest
  ): Promise<DeployAgentResponse> {
    const resp = await this.client.request(
      "POST",
      "/api/onboarding/deploy-agent",
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Validate integration credentials before deployment.
   *
   * @param request - The credentials to validate.
   * @returns Whether the credentials are valid and any error message.
   */
  public async validateCredentials(
    request: ValidateCredentialsRequest
  ): Promise<ValidateCredentialsResponse> {
    const resp = await this.client.request(
      "POST",
      "/api/onboarding/validate-credentials",
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
