import { z } from "zod";
import { assertResponseStatus } from "../../client-helper";
import Client from "../../client.browser";
import type { OtelEvent, OtelLink, OtelSpan } from "../otlp/convert";

export const FieldFilterSchema = z.object({
  type: z.literal("eq"),
  key: z.string(),
  value: z.string(),
});

export const FieldFilterGroupSchema = z.object({
  type: z.literal("and"),
  get filters() {
    return z.array(z.union([FieldFilterSchema, FieldFilterGroupSchema]));
  },
});

export const SpansRequestSchema = z.object({
  start_time: z.iso.datetime().pipe(z.coerce.date()),
  end_time: z.iso.datetime().pipe(z.coerce.date()),
  filters: z
    .string()
    .transform((val) => JSON.parse(val))
    .pipe(FieldFilterGroupSchema),
  limit: z
    .string()
    .pipe(z.coerce.number<string>().min(1).max(10_000))
    .optional(),
});

export type FieldFilter = z.infer<typeof FieldFilterSchema>;
export type FieldFilterGroup = z.infer<typeof FieldFilterGroupSchema>;
export type SpansRequest = z.infer<typeof SpansRequestSchema>;

export type GetSpansResponse = { traces: OtelSpan[] };
export type { OtelEvent, OtelLink, OtelSpan };

export default class AgentTraces {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async spans(
    request: SpansRequest & { agent_id: string }
  ): Promise<GetSpansResponse> {
    const query = new URLSearchParams();
    query.set("start_time", request.start_time.toISOString());
    query.set("end_time", request.end_time.toISOString());
    query.set("filters", JSON.stringify(request.filters));
    if (request.limit !== undefined) {
      query.set("limit", request.limit.toString());
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/traces/spans?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    const data = (await resp.json()) as GetSpansResponse;
    return data;
  }
}
