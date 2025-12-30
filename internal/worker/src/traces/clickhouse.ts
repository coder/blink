import type { FieldFilterGroup } from "@blink.so/api";
import { type OtelSpan } from "@blink.so/api/server";
import { createClient } from "@clickhouse/client-web";
import { compileFilters } from "../clickhouse/filters";
import type { ClickHouseConfig } from "../clickhouse/types";
import { formatDate } from "../clickhouse/utils";

export type { ClickHouseConfig };

export async function writeTraces(
  spans: OtelSpan[],
  config: ClickHouseConfig
): Promise<void> {
  if (spans.length === 0) {
    return;
  }

  const client = createClient(config);

  const values = spans.map((span) => ({
    agent_id: span.agent_id,
    created_at: formatDate(new Date()),
    start_time: span.start_time,
    end_time: span.end_time,
    payload_original: JSON.stringify(span.payload),
    payload: span.payload,
  }));

  await client.insert({
    table: "agent_spans",
    values,
    format: "JSONEachRow",
  });
}

export interface ReadTracesOpts {
  agent_id: string;
  filters: FieldFilterGroup;
  start_time?: Date;
  end_time?: Date;
  limit: number;
}

export function compileQuery(opts: ReadTracesOpts): {
  query: string;
  params: Record<string, string | number>;
} {
  const { query: filterQuery, params: filterParams } = compileFilters(
    opts.filters
  );
  const start_time_param = opts.start_time
    ? { start_time: formatDate(opts.start_time) }
    : undefined;
  const end_time_param = opts.end_time
    ? { end_time: formatDate(opts.end_time) }
    : undefined;
  const start_time_filter = start_time_param
    ? `start_time > {start_time: DateTime64(9, 'UTC')}`
    : "";
  const end_time_filter = end_time_param
    ? `end_time <= {end_time: DateTime64(9, 'UTC')}`
    : "";
  const andClauses = [
    `agent_id = {agentId: String}`,
    start_time_filter,
    end_time_filter,
    filterQuery,
  ];
  const andClausesString = andClauses.filter(Boolean).join(" AND ");
  return {
    query: `SELECT
        agent_id,
        created_at,
        start_time,
        end_time,
        payload_original
      FROM agent_spans
      WHERE
        ${andClausesString}
      ORDER BY
        start_time DESC
      LIMIT {limit: UInt64}
    `,
    params: {
      ...start_time_param,
      ...end_time_param,
      ...filterParams,
      agentId: opts.agent_id,
      limit: opts.limit,
    },
  };
}

export async function readTraces(
  opts: ReadTracesOpts,
  config: ClickHouseConfig
): Promise<(OtelSpan & { created_at: string })[]> {
  const client = createClient(config);
  const { query, params } = compileQuery(opts);

  const result = await client.query({
    query,
    query_params: params,
    clickhouse_settings: {
      // without this setting, if we query a JSON column with a number field,
      // it will be returned as a string instead of a number
      output_format_json_quote_64bit_integers: 0,
    },
  });

  const data = await result.json();
  await client.close();
  const queryData = (data as any).data;
  return queryData.map((row: any) => ({
    agent_id: row.agent_id,
    created_at: row.created_at,
    start_time: row.start_time,
    end_time: row.end_time,
    payload: JSON.parse(row.payload_original),
  }));
}
