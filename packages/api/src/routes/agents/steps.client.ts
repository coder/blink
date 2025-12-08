import { z } from "zod";
import {
  assertResponseStatus,
  schemaCursorPaginatedRequest,
  schemaCursorPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";
import {
  schemaChatRunStepStatus,
  schemaChatRunStepSummary,
  type ChatRunStep,
  type ChatRunStepSummary,
} from "../chats/steps.client";

export type AgentRunStepSummary = ChatRunStepSummary;

export type AgentRunStep = ChatRunStep;

export const schemaListAgentRunStepsRequest =
  schemaCursorPaginatedRequest.extend({
    agent_id: z.uuid(),
    agent_deployment_id: z.uuid().optional(),
    chat_id: z.uuid().optional(),
    run_id: z.uuid().optional(),
    status: schemaChatRunStepStatus.optional(),
  });

export type ListAgentRunStepsRequest = z.infer<
  typeof schemaListAgentRunStepsRequest
>;

export const schemaListAgentRunStepsResponse = schemaCursorPaginatedResponse(
  schemaChatRunStepSummary
);

export type ListAgentRunStepsResponse = z.infer<
  typeof schemaListAgentRunStepsResponse
>;

export interface GetAgentRunStepRequest {
  agent_id: string;
  step_id: string;
}

export default class AgentSteps {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async list(
    request: ListAgentRunStepsRequest
  ): Promise<ListAgentRunStepsResponse> {
    const query = new URLSearchParams();
    if (request.run_id) {
      query.set("run_id", request.run_id);
    }
    if (request.agent_deployment_id) {
      query.set("agent_deployment_id", request.agent_deployment_id);
    }
    if (request.chat_id) {
      query.set("chat_id", request.chat_id);
    }
    if (request.status) {
      query.set("status", request.status);
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/steps?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  public async get(request: GetAgentRunStepRequest): Promise<AgentRunStep> {
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/steps/${request.step_id}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
