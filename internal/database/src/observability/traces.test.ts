import { describe, expect, test } from "bun:test";
import connectToPostgres from "../postgres";
import Querier from "../querier";
import { createPostgresURL, createTestAgent } from "../test";
import {
  checkForDotKeys,
  type OtelSpan,
  readTraces,
  writeTraces,
} from "./traces";

type SpanOptions = {
  trace_id?: string;
  id?: string;
  name?: string;
  kind?: string;
  attributes?: Record<string, unknown>;
  resource?: Record<string, unknown>;
};

function createSpan(
  agentId: string,
  startOffset: number,
  endOffset: number,
  options: SpanOptions = {}
): OtelSpan {
  const now = Date.now();
  return {
    agent_id: agentId,
    start_time: new Date(now + startOffset).toISOString(),
    end_time: new Date(now + endOffset).toISOString(),
    payload: {
      span: {
        duration_ns: "1000000000",
        trace_id: options.trace_id ?? "trace-1",
        id: options.id ?? "span-1",
        parent_span_id: "",
        name: options.name ?? "test-span",
        kind: options.kind ?? "INTERNAL",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: options.attributes ?? {},
        events: [],
        links: [],
      },
      resource: options.resource ?? {},
      scope: {},
    },
  };
}

async function createTestContext() {
  const url = await createPostgresURL();
  const db = await connectToPostgres(url);
  const querier = new Querier(db);
  const agent = await createTestAgent(querier);
  return { db, agentId: agent.id, querier };
}

describe("Traces", () => {
  test("should insert and retrieve traces", async () => {
    const { db, agentId } = await createTestContext();

    const span = createSpan(agentId, -1000, 0, {
      trace_id: "abc123",
      name: "test-span",
    });

    await writeTraces(db, [span]);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: { type: "and", filters: [] },
      limit: 100,
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]?.payload.span.name).toBe("test-span");
    expect(traces[0]?.payload.span.trace_id).toBe("abc123");
  });

  test("should filter traces by time range", async () => {
    const { db, agentId } = await createTestContext();

    const oldSpan = createSpan(agentId, -60000, -59000, {
      trace_id: "old-trace",
      name: "old-span",
    });
    const recentSpan = createSpan(agentId, -1000, 0, {
      trace_id: "recent-trace",
      name: "recent-span",
    });

    await writeTraces(db, [oldSpan, recentSpan]);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: { type: "and", filters: [] },
      start_time: new Date(Date.now() - 30000),
      limit: 100,
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]?.payload.span.name).toBe("recent-span");
  });

  test("should filter traces by span name", async () => {
    const { db, agentId } = await createTestContext();

    const spans = [
      createSpan(agentId, -2000, -1000, {
        trace_id: "trace1",
        name: "http-request",
        kind: "CLIENT",
      }),
      createSpan(agentId, -1000, 0, {
        trace_id: "trace2",
        name: "database-query",
        kind: "CLIENT",
      }),
    ];

    await writeTraces(db, spans);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: {
        type: "and",
        filters: [{ type: "eq", key: "span.name", value: "http-request" }],
      },
      limit: 100,
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]?.payload.span.name).toBe("http-request");
  });

  test("should filter traces by nested attributes", async () => {
    const { db, agentId } = await createTestContext();

    const spans = [
      createSpan(agentId, -2000, -1000, {
        trace_id: "trace-get",
        name: "http-request",
        kind: "CLIENT",
        attributes: { http: { request: { method_original: "GET" } } },
      }),
      createSpan(agentId, -1000, 0, {
        trace_id: "trace-post",
        name: "http-request",
        kind: "CLIENT",
        attributes: { http: { request: { method_original: "POST" } } },
        resource: {
          attributes: {
            blink: {
              run_id: "test-run-id",
              chat_id: "test-chat-id",
              step_id: "test-step-id",
            },
          },
        },
      }),
    ];

    await writeTraces(db, spans);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: {
        type: "and",
        filters: [
          {
            type: "eq",
            key: "resource.attributes.blink.run_id",
            value: "test-run-id",
          },
          {
            type: "eq",
            key: "resource.attributes.blink.chat_id",
            value: "test-chat-id",
          },
        ],
      },
      limit: 100,
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]?.payload.span.trace_id).toBe("trace-post");
    expect(traces[0]?.payload.resource.attributes.blink.run_id).toBe(
      "test-run-id"
    );
  });

  test("should handle multiple filters with AND logic", async () => {
    const { db, agentId } = await createTestContext();

    const spans = [
      createSpan(agentId, -3000, -2000, {
        trace_id: "trace1",
        name: "http-request",
        kind: "CLIENT",
      }),
      createSpan(agentId, -2000, -1000, {
        trace_id: "trace2",
        name: "http-request",
        kind: "SERVER",
      }),
      createSpan(agentId, -1000, 0, {
        trace_id: "trace3",
        name: "database-query",
        kind: "CLIENT",
      }),
    ];

    await writeTraces(db, spans);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: {
        type: "and",
        filters: [
          { type: "eq", key: "span.name", value: "http-request" },
          { type: "eq", key: "span.kind", value: "CLIENT" },
        ],
      },
      limit: 100,
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]?.payload.span.trace_id).toBe("trace1");
  });

  test("should return empty array when writing empty spans", async () => {
    const { db, agentId } = await createTestContext();

    await writeTraces(db, []);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: { type: "and", filters: [] },
      limit: 100,
    });

    expect(traces).toHaveLength(0);
  });

  test("should respect limit parameter", async () => {
    const { db, agentId } = await createTestContext();

    const spans = Array.from({ length: 10 }, (_, i) =>
      createSpan(agentId, -(10 - i) * 1000, -(9 - i) * 1000, {
        trace_id: `trace-${i}`,
        id: `span-${i}`,
        name: `span-${i}`,
      })
    );

    await writeTraces(db, spans);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: { type: "and", filters: [] },
      limit: 5,
    });

    expect(traces).toHaveLength(5);
  });

  test("should order traces by start_time descending", async () => {
    const { db, agentId } = await createTestContext();

    const spans = [
      createSpan(agentId, -3000, -2000, { trace_id: "oldest", name: "oldest" }),
      createSpan(agentId, -1000, 0, { trace_id: "newest", name: "newest" }),
    ];

    await writeTraces(db, spans);

    const traces = await readTraces(db, {
      agent_id: agentId,
      filters: { type: "and", filters: [] },
      limit: 100,
    });

    expect(traces).toHaveLength(2);
    expect(traces[0]?.payload.span.trace_id).toBe("newest");
    expect(traces[1]?.payload.span.trace_id).toBe("oldest");
  });
});

describe("checkForDotKeys", () => {
  test("returns false for null", () => {
    expect(checkForDotKeys(null)).toBe(false);
  });

  test("returns false for primitives", () => {
    expect(checkForDotKeys("string")).toBe(false);
    expect(checkForDotKeys(123)).toBe(false);
    expect(checkForDotKeys(true)).toBe(false);
    expect(checkForDotKeys(undefined)).toBe(false);
  });

  test("returns false for empty object", () => {
    expect(checkForDotKeys({})).toBe(false);
  });

  test("returns false for object with no dot keys", () => {
    expect(checkForDotKeys({ foo: "bar", baz: 123 })).toBe(false);
  });

  test("returns true for object with dot key at top level", () => {
    expect(checkForDotKeys({ "foo.bar": "value" })).toBe(true);
  });

  test("returns true for nested object with dot key", () => {
    expect(checkForDotKeys({ nested: { "foo.bar": "value" } })).toBe(true);
  });

  test("returns true for deeply nested object with dot key", () => {
    expect(checkForDotKeys({ a: { b: { c: { "has.dot": "value" } } } })).toBe(
      true
    );
  });

  test("returns false for empty array", () => {
    expect(checkForDotKeys([])).toBe(false);
  });

  test("returns false for array with primitives", () => {
    expect(checkForDotKeys(["a", "b", 1, 2])).toBe(false);
  });

  test("returns true for array containing object with dot key", () => {
    expect(checkForDotKeys([{ "foo.bar": "value" }])).toBe(true);
  });

  test("returns true for nested array with dot key", () => {
    expect(checkForDotKeys({ arr: [{ nested: { "a.b": 1 } }] })).toBe(true);
  });

  test("returns false for complex object without dot keys", () => {
    expect(
      checkForDotKeys({
        span: {
          name: "test",
          attributes: {
            http: { method: "GET" },
          },
        },
        resource: { service: { name: "api" } },
      })
    ).toBe(false);
  });
});
