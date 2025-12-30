import { createClient } from "@clickhouse/client-web";

const assertEnv = (name: string): string => {
  if (!process.env[name]) {
    throw new Error(`${name} is not set`);
  }
  return process.env[name];
};

export async function getAgentRuntimeUsage(opts: {
  agent_id: string;
  start_time: Date;
  end_time: Date;
}): Promise<string> {
  const client = createClient({
    url: assertEnv("CLICKHOUSE_HOST"),
    username: assertEnv("CLICKHOUSE_USERNAME"),
    password: assertEnv("CLICKHOUSE_PASSWORD"),
    database: assertEnv("CLICKHOUSE_DATABASE"),
  });

  const query = `
    SELECT
      SUM(toUInt64OrZero(CAST(payload.record.metrics.billedDurationMs AS String))) as total_ms
    FROM agent_logs
    WHERE agent_id = {agent_id: String}
      AND timestamp > {start_time: DateTime64(3, 'UTC')}
      AND timestamp <= {end_time: DateTime64(3, 'UTC')}
      AND payload.type = 'platform.report'
      AND match(CAST(metadata.log_group AS String), '^blink\\/agent\\/')
  `;

  const startTimeString = opts.start_time.toISOString();
  const endTimeString = opts.end_time.toISOString();

  const queryResult = await client.query({
    query,
    query_params: {
      agent_id: opts.agent_id,
      start_time: startTimeString.substring(0, startTimeString.length - 1),
      end_time: endTimeString.substring(0, endTimeString.length - 1),
    },
  });

  const queryData: {
    data: {
      total_ms: string;
    }[];
  } = (await queryResult.json()) as any;

  // Get total milliseconds, default to 0 if no results
  const totalMs = queryData.data[0]?.total_ms
    ? BigInt(queryData.data[0].total_ms)
    : 0n;

  // Convert milliseconds to seconds with decimal precision
  const seconds = totalMs / 1000n;
  const milliseconds = totalMs % 1000n;

  return `${seconds}.${milliseconds.toString().padStart(3, "0")}`;
}
