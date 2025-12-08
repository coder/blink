import { z } from "zod";
import {
  assertResponseStatus,
  schemaCursorPaginatedRequest,
  schemaCursorPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";
import { schemaChatRunStepStatus } from "./steps.client";

const schemaListChatRunsRequest = schemaCursorPaginatedRequest.extend({
  chat_id: z.uuid(),
});

export type ListChatRunsRequest = z.infer<typeof schemaListChatRunsRequest>;

export const schemaChatRun = z.object({
  id: z.uuid(),
  started_at: z.date(),
  agent_id: z.uuid(),
  agent_deployment_id: z.uuid().nullable(),
  chat_id: z.uuid(),
  step_count: z.number().int().positive(),
  status: schemaChatRunStepStatus.nullable(),
  error: z.string().nullable(),
});

export type ChatRun = z.infer<typeof schemaChatRun>;

const schemaListChatRunsResponse = schemaCursorPaginatedResponse(schemaChatRun);

export type ListChatRunsResponse = z.infer<typeof schemaListChatRunsResponse>;

export interface GetChatRunRequest {
  chat_id: string;
  run_id: string;
}

export default class ChatRuns {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async list(
    request: ListChatRunsRequest
  ): Promise<ListChatRunsResponse> {
    const params = new URLSearchParams();
    if (request.cursor) {
      params.set("cursor", request.cursor);
    }
    if (request.limit) {
      params.set("limit", request.limit.toString());
    }
    const resp = await this.client.request(
      "GET",
      `/api/chats/${request.chat_id}/runs?${params.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  public async get(request: GetChatRunRequest): Promise<ChatRun> {
    const resp = await this.client.request(
      "GET",
      `/api/chats/${request.chat_id}/runs/${request.run_id}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
