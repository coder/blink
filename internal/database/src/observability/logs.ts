import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agent_log } from "../schema";
import { compileFilters, type FieldFilterGroup } from "./filters";

export interface AgentLog {
  message: string;
  timestamp: Date;
  level: "info" | "warn" | "error";
}

const parseLevel = (level: string): "info" | "warn" | "error" => {
  const lowerCaseLevel = level.trim().toLowerCase();
  if (lowerCaseLevel.includes("info")) {
    return "info";
  }
  if (lowerCaseLevel.includes("warn")) {
    return "warn";
  }
  if (lowerCaseLevel.includes("error")) {
    return "error";
  }
  return "info";
};

/**
 * Convert user-friendly wildcard pattern to PostgreSQL regex.
 * Mirrors the Clickhouse implementation.
 * - `*` becomes `.*` (wildcard)
 * - `\*` stays as literal `*`
 * - Special regex chars are escaped
 */
export const regexFromText = (
  text: string,
  { caseInsensitive = false } = {}
): string => {
  // Escape special regex characters except * and \
  const escapeRegex = (str: string): string => {
    return str.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  };

  // Split by \* (literal asterisk) to preserve them
  const parts = text.split("\\\\*");
  const processed = parts.map((part) => {
    // Split by * (wildcard) and process each segment
    return part
      .split("*")
      .map((segment) => escapeRegex(segment))
      .join(".*");
  });

  return processed.join("\\\\*");
};

export async function getAgentLogs(
  db: NodePgDatabase<any>,
  opts: {
    agent_id: string;
    message_pattern?: string;
    filters?: FieldFilterGroup;
    start_time: Date;
    end_time: Date;
    limit: number;
  }
): Promise<AgentLog[]> {
  // Build WHERE clauses
  const whereClauses: SQL[] = [
    eq(agent_log.agent_id, opts.agent_id),
    gte(agent_log.timestamp, opts.start_time),
    lte(agent_log.timestamp, opts.end_time),
  ];

  // Add message pattern filter if provided
  if (opts.message_pattern) {
    const pattern = regexFromText(opts.message_pattern, {
      caseInsensitive: true,
    });
    // Use PostgreSQL's ~* operator for case-insensitive regex matching
    whereClauses.push(sql`${agent_log.payload_str} ~* ${pattern}`);
  }

  // Add advanced filters if provided
  if (opts.filters) {
    const filterSql = compileFilters(opts.filters, agent_log.payload);
    if (filterSql) {
      whereClauses.push(filterSql);
    }
  }

  const rows = await db
    .select({
      timestamp: agent_log.timestamp,
      payload_str: agent_log.payload_str,
      level: agent_log.level,
    })
    .from(agent_log)
    .where(and(...whereClauses))
    .orderBy(desc(agent_log.timestamp))
    .limit(opts.limit);

  return rows.map((row) => ({
    timestamp: row.timestamp,
    message: row.payload_str,
    level: parseLevel(row.level),
  }));
}

export async function writeAgentLog(
  db: NodePgDatabase<any>,
  opts: {
    agent_id: string;
    event: Record<string, unknown>;
  }
): Promise<void> {
  const level =
    typeof opts.event.level === "string"
      ? parseLevel(opts.event.level)
      : "info";

  await db.insert(agent_log).values({
    agent_id: opts.agent_id,
    level: level,
    payload: opts.event,
    metadata: { source: "platform" },
    payload_str: JSON.stringify(opts.event),
  });
}
