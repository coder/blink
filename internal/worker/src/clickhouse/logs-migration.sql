CREATE TABLE agent_logs
(
  id         UUID,
  agent_id   UUID,
  level      LowCardinality(FixedString(8)),
  payload    JSON CODEC(ZSTD),            -- fully accessible and searchable by the end user
  metadata   JSON CODEC(ZSTD),            -- not accessible by the end user
  timestamp  DateTime64(3, 'UTC'),
  payload_str String MATERIALIZED CAST(payload AS String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)          -- coarse time partitioning for pruning
ORDER BY (agent_id, timestamp, id)        -- equality on agent_id, range on timestamp
PRIMARY KEY (agent_id, timestamp);        -- shorter PK keeps primary index smaller
