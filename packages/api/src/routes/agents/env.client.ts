import { z } from "zod";
import { assertResponseStatus } from "../../client-helper";
import Client from "../../client.browser";
import { schemaAgentDeploymentTarget } from "./deployments.client";

const schemaListAgentEnvRequest = z.object({
  agent_id: z.uuid(),
  target: schemaAgentDeploymentTarget.array().optional(),
});

export type ListAgentEnvRequest = z.infer<typeof schemaListAgentEnvRequest>;

const schemaAgentEnvironmentVariable = z.object({
  id: z.uuid(),
  created_at: z.date(),
  updated_at: z.date(),
  created_by: z.uuid(),
  updated_by: z.uuid(),
  key: z.string(),
  value: z.string().nullable(),
  secret: z.boolean(),
  target: schemaAgentDeploymentTarget.array(),
});

export type AgentEnvironmentVariable = z.infer<
  typeof schemaAgentEnvironmentVariable
>;

export const schemaCreateAgentEnv = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
  target: schemaAgentDeploymentTarget.array().optional(),
  upsert: z.boolean().optional(),
});

export const schemaCreateAgentEnvRequest = schemaCreateAgentEnv.extend({
  agent_id: z.uuid(),
});

export type CreateAgentEnvRequest = z.infer<typeof schemaCreateAgentEnvRequest>;

const schemaDeleteAgentEnvRequest = z.object({
  agent_id: z.uuid(),
  id: z.uuid(),
});

export type DeleteAgentEnvRequest = z.infer<typeof schemaDeleteAgentEnvRequest>;

export const schemaUpdateAgentEnvRequest = z.object({
  agent_id: z.uuid(),
  id: z.uuid(),
  key: z.string().optional(),
  value: z.string().optional(),
  secret: z.boolean().optional(),
  target: schemaAgentDeploymentTarget
    .array()
    .default(["preview", "production"])
    .optional(),
});

export type UpdateAgentEnvRequest = z.infer<typeof schemaUpdateAgentEnvRequest>;

export default class AgentEnv {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List the environment variables for an agent.
   *
   * @param id - The id of the agent.
   * @returns The environment variables.
   * @returns
   */
  public async list(
    id: ListAgentEnvRequest
  ): Promise<AgentEnvironmentVariable[]> {
    const query = new URLSearchParams();
    if (id.target) {
      for (const target of id.target) {
        query.append("target", target);
      }
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${id.agent_id}/env?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Create an environment variable for an agent.
   *
   * @param request - The request body.
   * @returns The environment variable.
   */
  public async create(
    request: CreateAgentEnvRequest
  ): Promise<AgentEnvironmentVariable> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${request.agent_id}/env`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete an environment variable for an agent.
   *
   * @param request - The request body.
   * @returns The environment variable.
   */
  public async delete(request: DeleteAgentEnvRequest): Promise<void> {
    const resp = await this.client.request(
      "DELETE",
      `/api/agents/${request.agent_id}/env/${request.id}`
    );
    await assertResponseStatus(resp, 204);
  }

  /**
   * Update an environment variable for an agent.
   *
   * @param request - The request body.
   * @returns The environment variable.
   */
  public async update(
    request: UpdateAgentEnvRequest
  ): Promise<AgentEnvironmentVariable> {
    const resp = await this.client.request(
      "PUT",
      `/api/agents/${request.agent_id}/env/${request.id}`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
