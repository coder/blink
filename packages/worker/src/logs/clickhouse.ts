import type { FieldFilterGroup } from "@blink.so/api";
import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { RE2JS } from "re2js";
import { compileFilters } from "../clickhouse/filters";
import { formatDate } from "../clickhouse/utils";

const assertEnv = (name: string): string => {
  if (!process.env[name]) {
    throw new Error(`${name} is not set`);
  }
  return process.env[name];
};

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

export const regexFromText = (
  text: string,
  { caseInsensitive = false } = {}
): string => {
  const prefix = caseInsensitive ? "(?i)" : "";
  return (
    `${prefix}` +
    text
      .split("\\*")
      .map((s) => s.split("*").map(RE2JS.quote).join(".*"))
      .join("\\*")
  );
};

export async function getAgentLogs(
  opts: {
    agent_id: string;
    message_pattern?: string;
    filters?: FieldFilterGroup;
    start_time: Date;
    end_time: Date;
    limit: number;
  },
  config?: {
    url: string;
    username: string;
    password: string;
    database: string;
  }
): Promise<AgentLog[]> {
  const client = createClient(
    config || {
      url: assertEnv("CLICKHOUSE_HOST"),
      username: assertEnv("CLICKHOUSE_USERNAME"),
      password: assertEnv("CLICKHOUSE_PASSWORD"),
      database: assertEnv("CLICKHOUSE_DATABASE"),
    }
  );

  const startTimeString = opts.start_time.toISOString();
  const endTimeString = opts.end_time.toISOString();

  // Build filter clauses
  const filterClauses: string[] = [];
  const queryParams: Record<string, any> = {
    agent_id: opts.agent_id,
    start_time: startTimeString.substring(0, startTimeString.length - 1),
    end_time: endTimeString.substring(0, endTimeString.length - 1),
    limit: opts.limit,
  };

  // Add message_pattern filter if provided
  if (opts.message_pattern) {
    filterClauses.push(`match(payload_str, {message_pattern:String})`);
    queryParams.message_pattern = regexFromText(opts.message_pattern, {
      caseInsensitive: true,
    });
  }

  // Add advanced filters if provided
  if (opts.filters) {
    const { query: filterQuery, params: filterParams } = compileFilters(
      opts.filters
    );
    filterClauses.push(filterQuery);
    Object.assign(queryParams, filterParams);
  }

  const filterClausesString =
    filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : "";

  const query = `
    SELECT
        timestamp,
        payload_str,
        level
    FROM agent_logs
    WHERE agent_id = {agent_id:String}
    AND timestamp > {start_time:DateTime64(3, 'UTC')}
    AND timestamp <= {end_time:DateTime64(3, 'UTC')}
    ${filterClausesString}
    ORDER BY timestamp DESC
    LIMIT {limit:UInt64}
  `;

  const queryResult = await client.query({
    query,
    query_params: queryParams,
  });
  const queryData: {
    data: {
      timestamp: string;
      payload_str: string;
      level: string;
    }[];
  } = (await queryResult.json()) as any;

  const logs: AgentLog[] = queryData.data.map((row) => {
    return {
      timestamp: new Date(row.timestamp + "Z"),
      message: row.payload_str,
      level: parseLevel(row.level),
    };
  });

  return logs;
}

export async function writeAgentLog(opts: {
  client: ClickHouseClient;
  agent_id: string;
  event: Record<string, unknown>;
}): Promise<void> {
  const level =
    typeof opts.event.level === "string"
      ? parseLevel(opts.event.level)
      : "info";
  await opts.client.insert({
    format: "JSONEachRow",
    table: "agent_logs",
    values: [
      {
        id: crypto.randomUUID(),
        agent_id: opts.agent_id,
        level: level,
        payload: opts.event,
        metadata: { source: "platform" },
        timestamp: formatDate(new Date()),
      },
    ],
  });
}
