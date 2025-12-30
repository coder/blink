-- Core spans with nested JSON structure
CREATE TABLE IF NOT EXISTS agent_spans
(
  agent_id         UUID,

  created_at       DateTime64(9) CODEC(Delta, ZSTD(3)),

  -- Time
  start_time       DateTime64(9) CODEC(Delta, ZSTD(3)),
  end_time         DateTime64(9) CODEC(Delta, ZSTD(3)),

  payload          JSON,
  -- clickhouse converts JSON to a lossy internal format, so we store the original JSON
  -- so we can reconstruct the original JSON structure when reading the data back.
  payload_original      String,
  -- we also store the string representation of the payload
  -- so we can use it for queries. this is a temporary measure until
  -- we stop using JSON_VALUE in the queries.
  payload_str      String MATERIALIZED toString(payload)

)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (agent_id, start_time)
TTL created_at + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
