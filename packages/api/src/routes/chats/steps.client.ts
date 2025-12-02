import { z } from "zod";
import {
  assertResponseStatus,
  schemaCursorPaginatedRequest,
  schemaCursorPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";

export const schemaChatRunStepStatus = z.enum([
  "streaming",
  "stalled",
  "completed",
  "interrupted",
  "error",
]);

const schemaChatRunStepContinuationReason = z.enum([
  "tool_call",
  "queued_message",
]);

export const schemaChatRunStepSummary = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  chat_id: z.uuid(),
  chat_run_id: z.uuid(),
  agent_id: z.uuid(),
  agent_deployment_id: z.uuid(),
  started_at: z.string().datetime(),
  status: schemaChatRunStepStatus,

  error: z.string().nullable(),
  continuation_reason: schemaChatRunStepContinuationReason.nullable(),
  response_status: z.number().nullable(),
  response_message_id: z.uuid().nullable(),
  time_to_first_token_micros: z.number().nullable(),
});

export type ChatRunStepSummary = z.infer<typeof schemaChatRunStepSummary>;

const schemaChatRunStep = schemaChatRunStepSummary.extend({
  heartbeat_at: z.date(),
  completed_at: z.date().nullable(),
  interrupted_at: z.date().nullable(),
  first_message_id: z.uuid().nullable(),
  last_message_id: z.uuid().nullable(),
  response_headers: z.record(z.string(), z.string()).nullable(),
  response_headers_redacted: z.boolean(),
  response_body: z.string().nullable(),
  response_body_redacted: z.boolean(),
  usage_model: z.string().nullable(),
  usage_total_input_tokens: z.number().nullable(),
  usage_total_output_tokens: z.number().nullable(),
  usage_total_tokens: z.number().nullable(),
  usage_total_cached_input_tokens: z.number().nullable(),
  usage_cost_usd: z.number().nullable(),
});

export type ChatRunStep = z.infer<typeof schemaChatRunStep>;

const schemaListChatRunStepsRequest = schemaCursorPaginatedRequest.extend({
  chat_id: z.uuid(),
  run_id: z.uuid().optional(),
});

export type ListChatRunStepsRequest = z.infer<
  typeof schemaListChatRunStepsRequest
>;

const schemaListChatRunStepsResponse = schemaCursorPaginatedResponse(
  schemaChatRunStepSummary
);

export type ListChatRunStepsResponse = z.infer<
  typeof schemaListChatRunStepsResponse
>;

export interface GetChatRunStepRequest {
  chat_id: string;
  step_id: string;
}

export default class ChatSteps {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async list(
    request: ListChatRunStepsRequest
  ): Promise<ListChatRunStepsResponse> {
    const query = new URLSearchParams();
    if (request.run_id) {
      query.set("run_id", request.run_id);
    }
    const resp = await this.client.request(
      "GET",
      `/api/chats/${request.chat_id}/steps?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  public async get(request: GetChatRunStepRequest): Promise<ChatRunStep> {
    const resp = await this.client.request(
      "GET",
      `/api/chats/${request.chat_id}/steps/${request.step_id}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
