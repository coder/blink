import { z } from "zod";
import type Client from "../../client.browser";
import { assertResponseStatus } from "../../client-helper";

export const schemaDownloadAgentRequest = z.object({
  organization_id: z.uuid(),
});

export type DownloadAgentRequest = z.infer<typeof schemaDownloadAgentRequest>;

export const schemaDownloadAgentFile = z.object({
  path: z.string(),
  id: z.uuid(),
});

export type DownloadAgentFile = z.infer<typeof schemaDownloadAgentFile>;

export const schemaDownloadAgentResponse = z.object({
  output_files: z.array(schemaDownloadAgentFile),
  source_files: z.array(schemaDownloadAgentFile),
  entrypoint: z.string(),
  version: z.string().optional(),
});

export type DownloadAgentResponse = z.infer<typeof schemaDownloadAgentResponse>;

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
}
