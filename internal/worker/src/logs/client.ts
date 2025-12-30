import { createClient } from "@clickhouse/client-web";
import { writeAgentLog } from "./clickhouse";

export interface ClickHouseCredentials {
  CLICKHOUSE_HOST?: string;
  CLICKHOUSE_USERNAME?: string;
  CLICKHOUSE_PASSWORD?: string;
  CLICKHOUSE_DATABASE?: string;
}

export async function writePlatformLog(
  creds: ClickHouseCredentials,
  opts: { agentId: string; event: Record<string, unknown> }
): Promise<void> {
  if (
    !creds.CLICKHOUSE_HOST ||
    !creds.CLICKHOUSE_USERNAME ||
    !creds.CLICKHOUSE_PASSWORD ||
    !creds.CLICKHOUSE_DATABASE
  ) {
    console.warn("ClickHouse credentials not provided. Skipping platform log.");
    return;
  }

  const client = createClient({
    url: creds.CLICKHOUSE_HOST,
    username: creds.CLICKHOUSE_USERNAME,
    password: creds.CLICKHOUSE_PASSWORD,
    database: creds.CLICKHOUSE_DATABASE,
  });

  try {
    await writeAgentLog({
      client,
      agent_id: opts.agentId,
      event: opts.event,
    });
  } catch (err) {
    console.error("Failed to write platform log:", err);
  }
}
