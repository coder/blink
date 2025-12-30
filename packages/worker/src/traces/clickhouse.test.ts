import type { OtelSpan } from "@blink.so/api/server";
import { createClient } from "@clickhouse/client-web";
import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  isClickHouseUnavailable,
  testConfig,
  withTestDatabase,
} from "../clickhouse/test-helpers";
import {
  compileQuery,
  readTraces,
  writeTraces,
  type ReadTracesOpts,
} from "./clickhouse";

async function querySpans(dbName: string): Promise<any[]> {
  const client = createClient({
    ...testConfig,
    database: dbName,
  });

  const result = await client.query({
    query: `
      SELECT 
        agent_id,
        start_time,
        end_time,
        payload
      FROM agent_spans 
      ORDER BY created_at
    `,
  });

  const data = await result.json();
  await client.close();
  return (data as any).data;
}

const TEST_AGENT_ID = "6c87dba5-3ef2-45ed-ad43-b1025f0f6238";

const createTestSpan = (overrides: Partial<OtelSpan> = {}): OtelSpan => ({
  agent_id: TEST_AGENT_ID,
  start_time: "2024-01-01 00:00:00.000000000",
  end_time: "2024-01-01 00:00:01.000000000",
  payload: {
    span: {
      duration_ns: "1000000000",
      trace_id: "abcdef1234567890abcdef1234567890",
      id: "abcdef1234567890",
      parent_span_id: "1234567890abcdef",
      name: "test-span",
      kind: "INTERNAL",
      status_code: "OK",
      status_message: "",
      trace_state: "",
      flags: 0,
      dropped_attributes_count: 0,
      dropped_events_count: 0,
      dropped_links_count: 0,
      attributes: { operation: "test" },
      events: [],
      links: [],
    },
    resource: {
      attributes: { service: "test-service" },
      dropped_attributes_count: 0,
      schema_url: "https://example.com/schema",
    },
    scope: {
      name: "test-scope",
      version: "1.0.0",
      attributes: { library: "test-lib" },
      dropped_attributes_count: 0,
    },
  },
  ...overrides,
});

describe.skipIf(await isClickHouseUnavailable())("writeTraces", () => {
  test("should insert a single span successfully", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const span = createTestSpan();

        await writeTraces([span], config);

        const spans = await querySpans(dbName);
        expect(spans).toHaveLength(1);

        const insertedSpan = spans[0];
        expect(insertedSpan.agent_id).toBe(TEST_AGENT_ID);
        expect(insertedSpan.payload.span.name).toBe("test-span");
        expect(insertedSpan.payload.span.kind).toBe("INTERNAL");
        expect(insertedSpan.payload.span.status_code).toBe("OK");
        expect(insertedSpan.payload.span.trace_id).toBe(
          "abcdef1234567890abcdef1234567890"
        );
        expect(insertedSpan.payload.span.id).toBe("abcdef1234567890");
        expect(insertedSpan.payload.span.parent_span_id).toBe(
          "1234567890abcdef"
        );
      }
    );
  });

  test("should insert multiple spans successfully", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "span-1",
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "span-2",
                id: "2222222222222222",
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "span-3",
                id: "3333333333333333",
              },
            },
          }),
        ];

        await writeTraces(spans, config);

        const insertedSpans = await querySpans(dbName);
        expect(insertedSpans).toHaveLength(3);

        const names = insertedSpans.map((s) => s.payload.span.name).sort();
        expect(names).toEqual(["span-1", "span-2", "span-3"]);
      }
    );
  });

  test("should handle empty spans array", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        await writeTraces([], config);

        const spans = await querySpans(dbName);
        expect(spans).toHaveLength(0);
      }
    );
  });

  test("should handle spans with empty trace/span IDs", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const span = createTestSpan({
          payload: {
            ...createTestSpan().payload,
            span: {
              ...createTestSpan().payload.span,
              trace_id: "",
              id: "",
              parent_span_id: "",
            },
          },
        });

        await writeTraces([span], config);

        const spans = await querySpans(dbName);
        expect(spans).toHaveLength(1);

        const insertedSpan = spans[0];
        expect(insertedSpan.payload.span.trace_id).toBe("");
        expect(insertedSpan.payload.span.id).toBe("");
        expect(insertedSpan.payload.span.parent_span_id).toBe("");
      }
    );
  });

  test("should handle all span kinds", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const kinds = [
          "UNSPECIFIED",
          "INTERNAL",
          "SERVER",
          "CLIENT",
          "PRODUCER",
          "CONSUMER",
        ];
        const spans = kinds.map((kind, i) =>
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: `span-${kind}`,
                id: `000000000000000${i}`,
                kind,
              },
            },
          })
        );

        await writeTraces(spans, config);

        const insertedSpans = await querySpans(dbName);
        expect(insertedSpans).toHaveLength(6);

        for (const kind of kinds) {
          expect(insertedSpans.some((s) => s.payload.span.kind === kind)).toBe(
            true
          );
        }
      }
    );
  });

  test("should handle all status codes", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const statusCodes = ["UNSET", "OK", "ERROR"];
        const spans = statusCodes.map((status_code, i) =>
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: `span-${status_code}`,
                id: `000000000000000${i}`,
                status_code,
              },
            },
          })
        );

        await writeTraces(spans, config);

        const insertedSpans = await querySpans(dbName);
        expect(insertedSpans).toHaveLength(3);

        for (const statusCode of statusCodes) {
          expect(
            insertedSpans.some((s) => s.payload.span.status_code === statusCode)
          ).toBe(true);
        }
      }
    );
  });

  test("should preserve JSON attributes", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const span = createTestSpan({
          payload: {
            ...createTestSpan().payload,
            resource: {
              ...createTestSpan().payload.resource,
              attributes: { service: "my-service", version: "1.0.0" },
            },
            span: {
              ...createTestSpan().payload.span,
              attributes: { method: "GET", path: "/api/test" },
            },
            scope: {
              ...createTestSpan().payload.scope,
              attributes: { library: "opentelemetry", version: "1.2.3" },
            },
          },
        });

        await writeTraces([span], config);

        const spans = await querySpans(dbName);
        expect(spans).toHaveLength(1);

        const insertedSpan = spans[0];
        expect(insertedSpan.payload.resource.attributes).toEqual({
          service: "my-service",
          version: "1.0.0",
        });
        expect(insertedSpan.payload.span.attributes).toEqual({
          method: "GET",
          path: "/api/test",
        });
        expect(insertedSpan.payload.scope.attributes).toEqual({
          library: "opentelemetry",
          version: "1.2.3",
        });
      }
    );
  });

  test("should handle nullable fields", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const span = createTestSpan({
          payload: {
            ...createTestSpan().payload,
            resource: {
              ...createTestSpan().payload.resource,
              schema_url: undefined,
            },
            scope: {
              ...createTestSpan().payload.scope,
              name: undefined,
              version: undefined,
              schema_url: undefined,
            },
          },
        });

        await writeTraces([span], config);

        const spans = await querySpans(dbName);
        expect(spans).toHaveLength(1);

        const insertedSpan = spans[0];
        expect(insertedSpan.payload.scope.name).toBeUndefined();
        expect(insertedSpan.payload.scope.version).toBeUndefined();
        expect(insertedSpan.payload.resource.schema_url).toBeUndefined();
        expect(insertedSpan.payload.scope.schema_url).toBeUndefined();
      }
    );
  });
});

describe("compileQuery", () => {
  const removeWhitespace = (str: string) => str.replaceAll(/\s+/g, "");

  test("should compile a query", () => {
    const opts = {
      agent_id: TEST_AGENT_ID,
      filters: {
        type: "and",
        filters: [{ type: "eq", key: "testKey", value: "testValue" }],
      },
      limit: 100,
    } satisfies ReadTracesOpts;
    const result = compileQuery(opts);
    expect(removeWhitespace(result.query)).toBe(
      removeWhitespace(
        "SELECT agent_id, created_at, start_time, end_time, payload_original FROM agent_spans WHERE agent_id = {agentId: String} AND (JSON_VALUE(payload_str, {k0: String}) = {v0: String}) ORDER BY start_time DESC LIMIT {limit: UInt64}"
      )
    );
    expect(result.params).toEqual({
      agentId: TEST_AGENT_ID,
      k0: "$.testKey",
      v0: "testValue",
      limit: 100,
    });
  });
  test("should compile a query with start_time and end_time", () => {
    const opts = {
      agent_id: TEST_AGENT_ID,
      filters: {
        type: "and",
        filters: [{ type: "eq", key: "testKey", value: "testValue" }],
      },
      limit: 100,
      start_time: new Date("2024-01-01"),
      end_time: new Date("2024-01-02"),
    } satisfies ReadTracesOpts;
    const result = compileQuery(opts);
    expect(removeWhitespace(result.query)).toBe(
      removeWhitespace(
        "SELECT agent_id, created_at, start_time, end_time, payload_original FROM agent_spans WHERE agent_id = {agentId: String} AND start_time > {start_time: DateTime64(9, 'UTC')} AND end_time <= {end_time: DateTime64(9, 'UTC')} AND (JSON_VALUE(payload_str, {k0: String}) = {v0: String}) ORDER BY start_time DESC LIMIT {limit: UInt64}"
      )
    );
    expect(result.params).toEqual({
      agentId: TEST_AGENT_ID,
      k0: "$.testKey",
      v0: "testValue",
      limit: 100,
      start_time: "2024-01-01 00:00:00.000",
      end_time: "2024-01-02 00:00:00.000",
    });
  });
});

describe.skipIf(await isClickHouseUnavailable())("readTraces", () => {
  test("should read traces", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [createTestSpan()];
        await writeTraces(spans, config);
        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 100,
          },
          config
        );
        expect(result).toMatchObject(spans);
        expect(typeof result[0]?.created_at).toBe("string");
      }
    );
  });

  // Filter-based Tests
  test("should filter traces by single attribute", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "matching-span",
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "non-matching-span",
                id: "2222222222222222",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [
                { type: "eq", key: "span.name", value: "matching-span" },
              ],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect((result[0] as any).payload.span.name).toBe("matching-span");
      }
    );
  });

  test("should filter traces by multiple attributes", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "matching-span",
                kind: "SERVER",
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "matching-span",
                kind: "CLIENT",
                id: "2222222222222222",
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "other-span",
                kind: "SERVER",
                id: "3333333333333333",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [
                { type: "eq", key: "span.name", value: "matching-span" },
                { type: "eq", key: "span.kind", value: "SERVER" },
              ],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect((result[0] as any).payload.span.name).toBe("matching-span");
        expect((result[0] as any).payload.span.kind).toBe("SERVER");
      }
    );
  });

  test("should return empty result when no spans match filter", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [createTestSpan()];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [
                { type: "eq", key: "span.name", value: "non-existent-span" },
              ],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(0);
      }
    );
  });

  // Time Range Tests
  test("should filter traces by start time only", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            start_time: "2024-01-01 10:00:00.000000000",
            end_time: "2024-01-01 10:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 12:00:00.000000000",
            end_time: "2024-01-01 12:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "2222222222222222",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            start_time: new Date("2024-01-01 11:00:00"),
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect((result[0] as any).start_time).toBe(
          "2024-01-01 12:00:00.000000000"
        );
      }
    );
  });

  test("should filter traces by end time only", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            start_time: "2024-01-01 10:00:00.000000000",
            end_time: "2024-01-01 10:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 12:00:00.000000000",
            end_time: "2024-01-01 12:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "2222222222222222",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            end_time: new Date("2024-01-01 11:00:00"),
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect((result[0] as any).end_time).toBe(
          "2024-01-01 10:00:01.000000000"
        );
      }
    );
  });

  test("should filter traces by time window", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            start_time: "2024-01-01 09:00:00.000000000",
            end_time: "2024-01-01 09:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 11:00:00.000000000",
            end_time: "2024-01-01 11:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "2222222222222222",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 13:00:00.000000000",
            end_time: "2024-01-01 13:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "3333333333333333",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            start_time: new Date("2024-01-01 10:00:00"),
            end_time: new Date("2024-01-01 12:00:00"),
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect((result[0] as any).start_time).toBe(
          "2024-01-01 11:00:00.000000000"
        );
      }
    );
  });

  test("should handle time boundary edge cases", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const boundaryTime = new Date("2024-01-01 10:00:00");
        const spans = [
          createTestSpan({
            start_time: "2024-01-01 10:00:00.000000000", // Exactly at boundary
            end_time: "2024-01-01 10:00:00.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 10:00:00.000000001", // Just after boundary
            end_time: "2024-01-01 10:00:00.000000001",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "2222222222222222",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            start_time: boundaryTime,
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect((result[0] as any).start_time).toBe(
          "2024-01-01 10:00:00.000000001"
        );
      }
    );
  });

  // Limit and Pagination Tests
  test("should enforce limit on results", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = Array.from({ length: 10 }, (_, i) =>
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: `${i.toString().padStart(16, "0")}`,
              },
            },
          })
        );
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 5,
          },
          config
        );

        expect(result).toHaveLength(5);
      }
    );
  });

  test("should handle zero limit", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [createTestSpan()];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 0,
          },
          config
        );

        expect(result).toHaveLength(0);
      }
    );
  });

  test("should handle limit larger than available data", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [createTestSpan(), createTestSpan()];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 1000,
          },
          config
        );

        expect(result).toHaveLength(2);
      }
    );
  });

  // Multi-Agent Scenarios
  test("should isolate traces by agent", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const agent1Id = "422c6f0a-80d8-4f33-8509-c70e890381c7";
        const agent2Id = "062b9b75-8325-4508-b93b-3dd4aff23ea3";
        const spans = [
          createTestSpan({
            agent_id: agent1Id,
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            agent_id: agent2Id,
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "2222222222222222",
              },
            },
          }),
          createTestSpan({
            agent_id: agent1Id,
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                id: "3333333333333333",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: agent1Id,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(2);
        result.forEach((span) => {
          expect(span.agent_id).toBe(agent1Id);
        });
      }
    );
  });

  test("should return empty for non-existent agent", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const existingAgentId = "422c6f0a-80d8-4f33-8509-c70e890381c7";
        const nonExistentAgentId = "062b9b75-8325-4508-b93b-3dd4aff23ea3";
        const spans = [createTestSpan({ agent_id: existingAgentId })];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: nonExistentAgentId,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(0);
      }
    );
  });

  // Combined Scenario Tests
  test("should combine filter, time range, and limit", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            start_time: "2024-01-01 10:00:00.000000000",
            end_time: "2024-01-01 10:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "matching-span",
                id: "1111111111111111",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 11:00:00.000000000",
            end_time: "2024-01-01 11:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "matching-span",
                id: "2222222222222222",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 12:00:00.000000000",
            end_time: "2024-01-01 12:00:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "matching-span",
                id: "3333333333333333",
              },
            },
          }),
          createTestSpan({
            start_time: "2024-01-01 11:30:00.000000000",
            end_time: "2024-01-01 11:30:01.000000000",
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "non-matching-span",
                id: "4444444444444444",
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [
                { type: "eq", key: "span.name", value: "matching-span" },
              ],
            },
            start_time: new Date("2024-01-01 10:30:00"),
            end_time: new Date("2024-01-01 11:45:00"),
            limit: 1,
          },
          config
        );

        expect(result).toHaveLength(1);
        expect(result[0]?.payload.span.name).toBe("matching-span");
        expect(result[0]?.start_time).toBe("2024-01-01 11:00:00.000000000");
      }
    );
  });

  test("should handle realistic span data scenario", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "GET /api/users",
                kind: "SERVER",
                attributes: {
                  "http.method": "GET",
                  "http.url": "/api/users",
                  "http.status_code": "200",
                },
                id: "1111111111111111",
              },
              resource: {
                ...createTestSpan().payload.resource,
                attributes: {
                  "service.name": "user-service",
                  "service.version": "1.0.0",
                },
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "SELECT FROM users",
                kind: "CLIENT",
                attributes: {
                  "db.system": "postgresql",
                  "db.operation": "SELECT",
                },
                id: "2222222222222222",
              },
              resource: {
                ...createTestSpan().payload.resource,
                attributes: {
                  "service.name": "user-service",
                  "service.version": "1.0.0",
                },
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [
                {
                  type: "eq",
                  key: "resource.attributes.service.name",
                  value: "user-service",
                },
              ],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(2);
        result.forEach((span) => {
          expect(span.payload.resource.attributes).toMatchObject({
            "service.name": "user-service",
            "service.version": "1.0.0",
          });
        });
      }
    );
  });

  test("should filter traces with nested filter groups", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "API_CALL",
                kind: "SERVER",
                attributes: {
                  "http.method": "GET",
                  "http.status_code": "200",
                },
                id: "1111111111111111",
              },
              resource: {
                ...createTestSpan().payload.resource,
                attributes: {
                  "service.name": "api-service",
                  "service.version": "1.0.0",
                },
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "API_CALL",
                kind: "SERVER",
                attributes: {
                  "http.method": "POST",
                  "http.status_code": "201",
                },
                id: "2222222222222222",
              },
              resource: {
                ...createTestSpan().payload.resource,
                attributes: {
                  "service.name": "api-service",
                  "service.version": "1.0.0",
                },
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "DB_QUERY",
                kind: "CLIENT",
                attributes: {
                  "db.system": "postgresql",
                  "db.operation": "SELECT",
                },
                id: "3333333333333333",
              },
              resource: {
                ...createTestSpan().payload.resource,
                attributes: {
                  "service.name": "db-service",
                  "service.version": "2.0.0",
                },
              },
            },
          }),
          createTestSpan({
            payload: {
              ...createTestSpan().payload,
              span: {
                ...createTestSpan().payload.span,
                name: "API_CALL",
                kind: "SERVER",
                attributes: {
                  "http.method": "GET",
                  "http.status_code": "404",
                },
                id: "4444444444444444",
              },
              resource: {
                ...createTestSpan().payload.resource,
                attributes: {
                  "service.name": "api-service",
                  "service.version": "1.0.0",
                },
              },
            },
          }),
        ];
        await writeTraces(spans, config);

        // Use nested filter: API_CALL spans AND service.name=api-service AND (nested group with method and status)
        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [
                { type: "eq", key: "span.name", value: "API_CALL" },
                { type: "eq", key: "span.kind", value: "SERVER" },
                {
                  type: "and",
                  filters: [
                    {
                      type: "eq",
                      key: "resource.attributes.service.name",
                      value: "api-service",
                    },
                    {
                      type: "and",
                      filters: [
                        {
                          type: "eq",
                          key: "span.attributes.http.method",
                          value: "GET",
                        },
                        {
                          type: "eq",
                          key: "span.attributes.http.status_code",
                          value: "200",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(1);

        // Should return only the GET 200 span (first span), filtering out POST 201, GET 404, and DB_QUERY
        const returnedSpan = result[0];
        expect(returnedSpan?.payload.span.name).toBe("API_CALL");
        expect(returnedSpan?.payload.span.kind).toBe("SERVER");
        expect(returnedSpan?.payload.span.attributes).toMatchObject({
          "http.method": "GET",
          "http.status_code": "200",
        });
        expect(returnedSpan?.payload.resource.attributes).toMatchObject({
          "service.name": "api-service",
          "service.version": "1.0.0",
        });
      }
    );
  });

  // Edge Cases
  test("should return empty result from empty database", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        // Don't insert any spans
        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(0);
      }
    );
  });

  test("should handle malformed time ranges (start after end)", async () => {
    await withTestDatabase(
      join(__dirname, "migration.sql"),
      async (dbName, config) => {
        const spans = [createTestSpan()];
        await writeTraces(spans, config);

        const result = await readTraces(
          {
            agent_id: TEST_AGENT_ID,
            filters: {
              type: "and",
              filters: [],
            },
            start_time: new Date("2024-01-02 00:00:00"),
            end_time: new Date("2024-01-01 00:00:00"), // end before start
            limit: 100,
          },
          config
        );

        expect(result).toHaveLength(0);
      }
    );
  });
});
