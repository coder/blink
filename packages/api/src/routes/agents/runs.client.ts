import { z } from "zod";
import {
  assertResponseStatus,
  schemaCursorPaginatedRequest,
  schemaCursorPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";
import type { ChatRun } from "../chats/runs.client";
import { schemaChatRun } from "../chats/runs.client";

export const schemaListAgentRunsRequest = schemaCursorPaginatedRequest.extend({
  agent_id: z.uuid(),
  agent_deployment_id: z.uuid().optional(),
});

export type ListAgentRunsRequest = z.infer<typeof schemaListAgentRunsRequest>;

// Right now, these are equal, but they might not
// always return the same data.
export type AgentRun = ChatRun;

export const schemaListAgentRunsResponse =
  schemaCursorPaginatedResponse(schemaChatRun);

export type ListAgentRunsResponse = z.infer<typeof schemaListAgentRunsResponse>;

export const schemaGetAgentRunRequest = z.object({
  agent_id: z.uuid(),
  run_id: z.uuid(),
});

export type GetAgentRunRequest = z.infer<typeof schemaGetAgentRunRequest>;

export default class AgentRuns {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List runs for an agent.
   */
  public async list(
    request: ListAgentRunsRequest
  ): Promise<ListAgentRunsResponse> {
    const params = new URLSearchParams();
    if (request.agent_deployment_id) {
      params.set("agent_deployment_id", request.agent_deployment_id);
    }
    if (request.limit) {
      params.set("limit", request.limit.toString());
    }
    if (request.cursor) {
      params.set("cursor", request.cursor);
    }
    const response = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/runs?${params.toString()}`
    );
    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * Get a run by ID.
   */
  public async get(request: GetAgentRunRequest): Promise<AgentRun> {
    const response = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/runs/${request.run_id}`
    );
    await assertResponseStatus(response, 200);
    return response.json();
  }
}
