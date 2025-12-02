import z from "zod";
import { assertResponseStatus } from "../../client-helper";
import Client from "../../client.browser";
import { FieldFilterGroupSchema } from "../agents/traces.client";

export const schemaGetAgentLogsRequest = z.object({
  start_time: z.iso.datetime().pipe(z.coerce.date()),
  end_time: z.iso.datetime().pipe(z.coerce.date()),
  // Simple filter - supports wildcard matching with *
  message_pattern: z.string().optional(),
  // Advanced filters - same as traces filtering
  filters: z
    .string()
    .transform((val) => JSON.parse(val))
    .pipe(FieldFilterGroupSchema)
    .optional(),
  limit: z
    .string()
    // the limits are dictated by the AWS API
    // https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_StartQuery.html#API_StartQuery_RequestSyntax
    .pipe(z.coerce.number<string>().min(1).max(10_000))
    .optional(),
});

export type GetAgentLogsRequest = z.infer<typeof schemaGetAgentLogsRequest>;

const schemaAgentLog = z.object({
  timestamp: z.iso.datetime().pipe(z.coerce.date()),
  message: z.string(),
  level: z.enum(["info", "error", "warn"]),
});

export type AgentLog = z.infer<typeof schemaAgentLog>;

const schemaGetAgentLogsResponse = z.object({
  logs: z.array(schemaAgentLog),
});

export type GetAgentLogsResponse = z.infer<typeof schemaGetAgentLogsResponse>;

export default class AgentLogs {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async logs(
    request: GetAgentLogsRequest & { agent_id: string }
  ): Promise<GetAgentLogsResponse> {
    const query = new URLSearchParams();
    query.set("start_time", request.start_time.toISOString());
    query.set("end_time", request.end_time.toISOString());
    if (request.limit) {
      query.set("limit", request.limit.toString());
    }
    if (request.message_pattern) {
      query.set("message_pattern", request.message_pattern);
    }
    if (request.filters) {
      query.set("filters", JSON.stringify(request.filters));
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/logs?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    const data = await resp.json();
    // this converts timestamp strings to Dates
    return schemaGetAgentLogsResponse.parse(data);
  }
}
