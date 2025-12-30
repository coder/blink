import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agent_trace } from "../schema";
import { compileFilters, type FieldFilterGroup } from "./filters";

export interface OtelSpanData {
  duration_ns: string;
  trace_id: string;
  id: string;
  parent_span_id: string;
  name: string;
  kind: string;
  status_code: string;
  status_message: string;
  trace_state: string;
  flags: number;
  dropped_attributes_count: number;
  dropped_events_count: number;
  dropped_links_count: number;
  attributes: Record<string, unknown>;
  events: any[];
  links: any[];
}

export interface OtelPayload {
  span: OtelSpanData;
  resource: any;
  scope: any;
}

export interface OtelSpan {
  agent_id: string;
  start_time: string;
  end_time: string;
  payload: OtelPayload;
}

export interface ReadTracesOpts {
  agent_id: string;
  filters: FieldFilterGroup;
  start_time?: Date;
  end_time?: Date;
  limit: number;
}

export async function writeTraces(
  db: NodePgDatabase<any>,
  spans: OtelSpan[]
): Promise<void> {
  if (spans.length === 0) {
    return;
  }

  const values = spans.map((span) => ({
    agent_id: span.agent_id,
    start_time: new Date(span.start_time),
    end_time: new Date(span.end_time),
    payload: span.payload as any,
    payload_original: JSON.stringify(span.payload),
    payload_str: JSON.stringify(span.payload),
  }));

  await db.insert(agent_trace).values(values);
}

export async function readTraces(
  db: NodePgDatabase<any>,
  opts: ReadTracesOpts
): Promise<(OtelSpan & { created_at: string })[]> {
  const whereClauses: SQL[] = [eq(agent_trace.agent_id, opts.agent_id)];

  if (opts.start_time) {
    whereClauses.push(gte(agent_trace.start_time, opts.start_time));
  }

  if (opts.end_time) {
    whereClauses.push(lte(agent_trace.end_time, opts.end_time));
  }

  // Add advanced filters
  const filterSql = compileFilters(opts.filters, agent_trace.payload);
  if (filterSql) {
    whereClauses.push(filterSql);
  }

  const rows = await db
    .select({
      agent_id: agent_trace.agent_id,
      created_at: agent_trace.created_at,
      start_time: agent_trace.start_time,
      end_time: agent_trace.end_time,
      payload_original: agent_trace.payload_original,
    })
    .from(agent_trace)
    .where(and(...whereClauses))
    .orderBy(desc(agent_trace.start_time))
    .limit(opts.limit);

  return rows.map((row) => ({
    agent_id: row.agent_id,
    created_at: row.created_at.toISOString(),
    start_time: row.start_time.toISOString(),
    end_time: row.end_time.toISOString(),
    payload: JSON.parse(row.payload_original),
  }));
}
