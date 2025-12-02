import { z } from "zod";
import {
  assertResponseStatus,
  schemaPaginatedRequest,
  schemaPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";

export const schemaGetAgentDeploymentRequest = z.union([
  z.object({
    agent_id: z.uuid(),
    deployment_id: z.uuid(),
  }),
  z.object({
    agent_id: z.uuid(),
    deployment_number: z.number().int().positive(),
  }),
]);

export type GetAgentDeploymentRequest = z.infer<
  typeof schemaGetAgentDeploymentRequest
>;

export const schemaDeleteAgentDeploymentRequest = z.object({
  agent_id: z.uuid(),
  deployment_id: z.uuid(),
});

export type DeleteAgentDeploymentRequest = z.infer<
  typeof schemaDeleteAgentDeploymentRequest
>;

export const schemaRedeployAgentDeploymentRequest = z.union([
  z.object({
    agent_id: z.uuid(),
    deployment_id: z.uuid(),
  }),
  z.object({
    agent_id: z.uuid(),
    deployment_number: z.number().int().positive(),
  }),
]);

export type RedeployAgentDeploymentRequest = z.infer<
  typeof schemaRedeployAgentDeploymentRequest
>;

export const schemaAgentDeploymentFile = z.object({
  path: z.string(),
  id: z.uuid(),
});

export type AgentDeploymentFile = z.infer<typeof schemaAgentDeploymentFile>;

export const schemaAgentDeploymentUploadFile = schemaAgentDeploymentFile.or(
  z.object({
    path: z.string(),
    // No inline data can exceed 5MB.
    data: z.string().max(1024 * 1024 * 5),
  })
);

export type AgentDeploymentUploadFile = z.infer<
  typeof schemaAgentDeploymentUploadFile
>;

export const schemaAgentDeploymentTarget = z.enum(["production", "preview"]);

export type AgentDeploymentTarget = z.infer<typeof schemaAgentDeploymentTarget>;

export const schemaCreateAgentDeploymentRequest = z
  .object({
    agent_id: z.uuid(),
    output_files: z.array(schemaAgentDeploymentUploadFile).optional(),
    source_files: z.array(schemaAgentDeploymentUploadFile).optional(),
    // Legacy field for backwards compatibility
    files: z.array(schemaAgentDeploymentUploadFile).optional(),
    target: schemaAgentDeploymentTarget,
    entrypoint: z.string().optional(),
    message: z.string().max(128).optional(),
  })
  .transform((data) => {
    // Map legacy 'files' field to 'output_files' if 'output_files' is not provided
    if (data.files && !data.output_files) {
      return {
        ...data,
        output_files: data.files,
        files: undefined,
      };
    }
    return data;
  });

export type CreateAgentDeploymentRequest = z.infer<
  typeof schemaCreateAgentDeploymentRequest
>;

export const schemaAgentDeployment = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  created_by: z.uuid().nullable(),
  created_from: z.enum(["cli"]),
  agent_id: z.uuid(),
  source_files: z.array(schemaAgentDeploymentFile),
  output_files: z.array(schemaAgentDeploymentFile),
  status: z.enum(["success", "failed", "deploying", "pending"]),
  target: schemaAgentDeploymentTarget,
  error_message: z.string().nullable(),
  user_message: z.string().nullable(),
  platform: z.enum(["lambda"]),
  platform_memory_mb: z.number().int().positive(),
  platform_region: z.string().nullable(),
});

export type AgentDeployment = z.infer<typeof schemaAgentDeployment>;

export const schemaAgentDeploymentLog = z.object({
  id: z.uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  agent_id: z.uuid(),
  deployment_id: z.uuid(),
  level: z.enum(["log", "info", "warning", "error"]),
  message: z.string(),
});

export type AgentDeploymentLog = z.infer<typeof schemaAgentDeploymentLog>;

export const schemaListAgentDeploymentsRequest = schemaPaginatedRequest.extend({
  agent_id: z.uuid(),
  order: z.enum(["asc", "desc"]).default("asc").optional(),
});

export type ListAgentDeploymentsRequest = z.infer<
  typeof schemaListAgentDeploymentsRequest
>;

export const schemaListAgentDeploymentsResponse = schemaPaginatedResponse(
  schemaAgentDeployment
);

export type ListAgentDeploymentsResponse = z.infer<
  typeof schemaListAgentDeploymentsResponse
>;

export default class AgentDeployments {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List the deployments for an agent.
   *
   * @param request - The request body.
   * @returns The deployments.
   */
  public async list(
    request: ListAgentDeploymentsRequest
  ): Promise<ListAgentDeploymentsResponse> {
    const query = new URLSearchParams();
    if (request.page) {
      query.set("page", request.page.toString());
    }
    if (request.per_page) {
      query.set("per_page", request.per_page.toString());
    }
    if (request.order) {
      query.set("order", request.order);
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/deployments?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Get a deployment.
   *
   * @param request - The request body.
   * @returns The deployment.
   */
  public async get(
    request: GetAgentDeploymentRequest
  ): Promise<AgentDeployment> {
    let param: string;
    if ("deployment_id" in request) {
      param = request.deployment_id;
    } else {
      param = request.deployment_number.toString();
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/deployments/${param}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Create a deployment.
   *
   * @param request - The request body.
   * @returns The deployment.
   */
  public async create(
    request: CreateAgentDeploymentRequest
  ): Promise<AgentDeployment> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${request.agent_id}/deployments`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete a deployment.
   *
   * @param request - The request body.
   * @returns The deployment.
   */
  public async delete(request: DeleteAgentDeploymentRequest): Promise<void> {
    const resp = await this.client.request(
      "DELETE",
      `/api/agents/${request.agent_id}/deployments/${request.deployment_id}`
    );
    await assertResponseStatus(resp, 200);
  }

  /**
   * Re-deploy an existing deployment.
   *
   * @param request - The request body.
   * @returns The new deployment.
   */
  public async redeploy(
    request: RedeployAgentDeploymentRequest
  ): Promise<AgentDeployment> {
    let param: string;
    if ("deployment_id" in request) {
      param = request.deployment_id;
    } else {
      param = request.deployment_number.toString();
    }
    const resp = await this.client.request(
      "POST",
      `/api/agents/${request.agent_id}/deployments/${param}/redeploy`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
