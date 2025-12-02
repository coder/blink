import { withFetch } from "@/.storybook/utils";
import type { OtelSpan } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import TracesList from "./list";

// Helper function to generate mock logs for a trace
function generateMockLogs(traceId: string, spanId: string) {
  const baseTime = new Date("2024-01-15T10:30:00.000Z");

  const isErrorTrace = traceId?.includes("error");

  const logs: Array<{
    timestamp: string;
    message: string;
    level: "info" | "error" | "warn";
  }> = [
    {
      timestamp: new Date(baseTime.getTime() + 10).toISOString(),
      message: JSON.stringify({
        message: "Starting request processing",
        level: "info",
        span_id: spanId,
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 250).toISOString(),
      message: "Plain text log: Initializing connection pool",
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 500).toISOString(),
      message: JSON.stringify({
        message: "Database query started",
        level: "info",
        query: "SELECT * FROM users WHERE id = $1",
        span_id: spanId,
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 800).toISOString(),
      message: "Connection established to database",
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 1200).toISOString(),
      message: JSON.stringify({
        message: "Database query completed",
        level: "info",
        duration_ms: 45,
        rows_returned: 1,
        span_id: spanId,
        trace_id: traceId,
      }),
      level: "info" as const,
    },
  ];

  if (isErrorTrace) {
    logs.push(
      {
        timestamp: new Date(baseTime.getTime() + 4500).toISOString(),
        message: "WARN: Connection attempt 3 failed, retrying...",
        level: "warn" as const,
      },
      {
        timestamp: new Date(baseTime.getTime() + 4900).toISOString(),
        message: JSON.stringify({
          message: "Request failed with error",
          level: "error",
          error: "Connection timeout after 5000ms",
          error_type: "TimeoutError",
          span_id: spanId,
          trace_id: traceId,
        }),
        level: "error" as const,
      },
      {
        timestamp: new Date(baseTime.getTime() + 5000).toISOString(),
        message: "ERROR: Connection pool exhausted",
        level: "error" as const,
      }
    );
  } else {
    logs.push(
      {
        timestamp: new Date(baseTime.getTime() + 1400).toISOString(),
        message: "ERROR: Rate limit exceeded for API endpoint",
        level: "error" as const,
      },
      {
        timestamp: new Date(baseTime.getTime() + 1500).toISOString(),
        message: JSON.stringify({
          message: "Cache miss for user profile",
          level: "warn",
          cache_key: "user:12345:profile",
          span_id: spanId,
          trace_id: traceId,
        }),
        level: "warn" as const,
      },
      {
        timestamp: new Date(baseTime.getTime() + 1800).toISOString(),
        message: "Preparing response payload",
        level: "info" as const,
      },
      {
        timestamp: new Date(baseTime.getTime() + 2100).toISOString(),
        message: JSON.stringify({
          message: "Failed to update analytics",
          level: "error",
          error_type: "NetworkError",
          span_id: spanId,
          trace_id: traceId,
        }),
        level: "error" as const,
      },
      {
        timestamp: new Date(baseTime.getTime() + 2300).toISOString(),
        message: JSON.stringify({
          message: "Request completed successfully",
          level: "info",
          status_code: 200,
          span_id: spanId,
          trace_id: traceId,
        }),
        level: "info" as const,
      }
    );
  }

  return logs;
}

const meta: Meta<typeof TracesList> = {
  title: "Components/TracesList",
  component: (props) => (
    <div className="h-screen max-h-screen">
      <TracesList {...props} />
    </div>
  ),
  parameters: {
    layout: "fullscreen",
  },
  args: {
    agentId: "test-agent-123",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Helper function to create mock spans
const createMockSpan = (overrides: Partial<OtelSpan> = {}): OtelSpan => {
  const defaultSpan: OtelSpan = {
    agent_id: "test-agent-123",
    start_time: "2024-01-15 10:30:00.123456789",
    end_time: "2024-01-15 10:30:02.456789012",
    payload: {
      span: {
        duration_ns: "2333332223",
        trace_id: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
        id: "span1234567890ab",
        parent_span_id: "",
        name: "process_request",
        kind: "SERVER",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "http.method": "POST",
          "http.route": "/api/chat",
          "http.status_code": 200,
        },
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
          "service.version": "1.0.0",
        },
        dropped_attributes_count: 0,
        schema_url: undefined,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
        schema_url: undefined,
      },
    },
  };

  return {
    ...defaultSpan,
    ...overrides,
    payload: {
      ...defaultSpan.payload,
      ...overrides.payload,
      span: {
        ...defaultSpan.payload.span,
        ...(overrides.payload?.span || {}),
      },
    },
  } as OtelSpan;
};

// Mock data for different scenarios
const mockSpansData: OtelSpan[] = [
  createMockSpan({
    start_time: "2024-01-15 10:30:00.123456789",
    end_time: "2024-01-15 10:30:02.456789012",
    payload: {
      span: {
        duration_ns: "2333332223",
        trace_id: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
        id: "span1234567890ab",
        parent_span_id: "",
        name: "handle_chat_request",
        kind: "SERVER",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "http.method": "POST",
          "http.route": "/api/chat",
          "http.status_code": 200,
          "user.id": "user_12345",
        },
        events: [
          {
            time: "2024-01-15 10:30:01.000000000",
            name: "request.received",
            dropped_attributes_count: 0,
            attributes: {
              message: "Chat request received",
            },
          },
        ],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
          "service.version": "1.0.0",
          "deployment.environment": "production",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  createMockSpan({
    start_time: "2024-01-15 10:29:55.000000000",
    end_time: "2024-01-15 10:30:00.123456789",
    payload: {
      span: {
        duration_ns: "5123456789",
        trace_id: "b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7",
        id: "span2345678901bc",
        parent_span_id: "",
        name: "execute_tool",
        kind: "INTERNAL",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "tool.name": "web_search",
          "tool.input": "latest AI news",
          "tool.result.count": 10,
        },
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
          "service.version": "1.0.0",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  createMockSpan({
    start_time: "2024-01-15 10:29:50.000000000",
    end_time: "2024-01-15 10:29:51.500000000",
    payload: {
      span: {
        duration_ns: "1500000000",
        trace_id: "c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8",
        id: "span3456789012cd",
        parent_span_id: "",
        name: "database_query",
        kind: "CLIENT",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "db.system": "postgresql",
          "db.statement": "SELECT * FROM users WHERE id = $1",
          "db.name": "blink_prod",
        },
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  createMockSpan({
    start_time: "2024-01-15 10:29:45.000000000",
    end_time: "2024-01-15 10:29:50.000000000",
    payload: {
      span: {
        duration_ns: "5000000000",
        trace_id: "d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9",
        id: "span4567890123de",
        parent_span_id: "",
        name: "llm_completion",
        kind: "CLIENT",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "llm.model": "claude-3-5-sonnet-20241022",
          "llm.provider": "anthropic",
          "llm.tokens.prompt": 1500,
          "llm.tokens.completion": 500,
        },
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
];

const errorSpansData: OtelSpan[] = [
  createMockSpan({
    start_time: "2024-01-15 10:30:00.000000000",
    end_time: "2024-01-15 10:30:05.000000000",
    payload: {
      span: {
        duration_ns: "5000000000",
        trace_id: "error123456789abcdef",
        id: "error_span_001",
        parent_span_id: "",
        name: "failed_database_connection",
        kind: "CLIENT",
        status_code: "ERROR",
        status_message: "Connection timeout after 5000ms",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "db.system": "postgresql",
          "error.type": "TimeoutError",
          "error.message": "Connection timeout",
        },
        events: [
          {
            time: "2024-01-15 10:30:05.000000000",
            name: "exception",
            dropped_attributes_count: 0,
            attributes: {
              "exception.type": "TimeoutError",
              "exception.message": "Connection timeout after 5000ms",
              "exception.stacktrace": "at Database.connect...",
            },
          },
        ],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  createMockSpan({
    start_time: "2024-01-15 10:29:55.000000000",
    end_time: "2024-01-15 10:30:25.000000000",
    payload: {
      span: {
        duration_ns: "30000000000",
        trace_id: "error234567890bcdefg",
        id: "error_span_002",
        parent_span_id: "",
        name: "api_request_timeout",
        kind: "CLIENT",
        status_code: "ERROR",
        status_message: "Request timeout after 30s",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {
          "http.method": "POST",
          "http.url": "https://api.example.com/chat",
          "http.status_code": 0,
          "error.type": "RequestTimeoutError",
        },
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
];

export const Default: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        // Check if this is a request for a specific trace
        const urlParams = new URLSearchParams(url.search);
        const filtersParam = urlParams.get("filters");

        if (filtersParam) {
          try {
            const filters = JSON.parse(filtersParam);
            // Check if filtering by trace_id
            if (
              filters.type === "and" &&
              filters.filters?.some(
                (f: any) =>
                  f.type === "eq" &&
                  f.key === "span.trace_id" &&
                  f.value === nestedTraceId
              )
            ) {
              // Return all spans for the nested trace
              return new Response(
                JSON.stringify({
                  traces: nestedSpansData,
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        // Return root spans for the list view (including nested trace root + other traces)
        return new Response(
          JSON.stringify({
            traces: [nestedSpansData[0], ...mockSpansData.slice(1)],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Handle logs API calls
      if (url.pathname.includes("/logs")) {
        const urlParams = new URLSearchParams(url.search);
        const filtersParam = urlParams.get("filters");

        if (filtersParam) {
          try {
            const filters = JSON.parse(filtersParam);
            const traceIdFilter = filters.filters?.find(
              (f: any) => f.key === "trace_id"
            );
            const traceId = traceIdFilter?.value;

            if (traceId) {
              // Find the span to get its ID
              const allSpans = [nestedSpansData[0], ...mockSpansData];
              const span = allSpans.find(
                (s) => s.payload.span.trace_id === traceId
              );
              const spanId = span?.payload.span.id || "unknown";

              return new Response(
                JSON.stringify({
                  logs: generateMockLogs(traceId, spanId),
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          } catch (e) {
            console.error("Error parsing filters:", e);
          }
        }
      }

      return undefined;
    }),
  ],
};

export const Loading: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        return new Promise(() => {}); // Never resolves, simulates loading state
      }
      return undefined;
    }),
  ],
};

export const Error: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        return new Response("{}", {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "application/json" },
        });
      }
      return undefined;
    }),
  ],
};

export const NetworkError: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        return new Response("", {
          status: 500,
          statusText: "Network error: Unable to reach tracing backend",
          headers: { "Content-Type": "application/json" },
        });
      }
      return undefined;
    }),
  ],
};

export const EmptySpans: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        return new Response(
          JSON.stringify({
            traces: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return undefined;
    }),
  ],
};

export const ErrorSpans: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        return new Response(
          JSON.stringify({
            traces: errorSpansData,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Handle logs API calls
      if (url.pathname.includes("/logs")) {
        const urlParams = new URLSearchParams(url.search);
        const filtersParam = urlParams.get("filters");

        if (filtersParam) {
          try {
            const filters = JSON.parse(filtersParam);
            const traceIdFilter = filters.filters?.find(
              (f: any) => f.key === "trace_id"
            );
            const traceId = traceIdFilter?.value;

            if (traceId) {
              const span = errorSpansData.find(
                (s) => s.payload.span.trace_id === traceId
              );
              const spanId = span?.payload.span.id || "unknown";

              return new Response(
                JSON.stringify({
                  logs: generateMockLogs(traceId, spanId),
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          } catch (e) {
            console.error("Error parsing filters:", e);
          }
        }
      }

      return undefined;
    }),
  ],
};

export const LargeDataset: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        const largeSpansData = Array.from({ length: 50 }, (_, i) => {
          const hasError = i % 10 === 0;
          const now = Date.now();
          const startMs = now - 1000 * 60 * i;
          const durationMs = Math.floor(Math.random() * 5000) + 100;

          return createMockSpan({
            start_time: new Date(startMs)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "000000"),
            end_time: new Date(startMs + durationMs)
              .toISOString()
              .replace("T", " ")
              .replace("Z", "000000"),
            payload: {
              span: {
                duration_ns: (durationMs * 1_000_000).toString(),
                trace_id: `trace${i.toString().padStart(32, "0")}`,
                id: `span${i.toString().padStart(16, "0")}`,
                parent_span_id: "",
                name: hasError ? `error_operation_${i}` : `operation_${i}`,
                kind:
                  i % 3 === 0 ? "SERVER" : i % 3 === 1 ? "CLIENT" : "INTERNAL",
                status_code: hasError ? "ERROR" : "OK",
                status_message: hasError ? "Operation failed" : "",
                trace_state: "",
                flags: 0,
                dropped_attributes_count: 0,
                dropped_events_count: 0,
                dropped_links_count: 0,
                attributes: {
                  "operation.index": i,
                  "operation.type": hasError ? "error" : "success",
                },
                events: [],
                links: [],
              },
              resource: {
                attributes: {
                  "service.name": "blink-agent",
                },
                dropped_attributes_count: 0,
              },
              scope: {
                name: "agent-tracer",
                version: "1.0.0",
                attributes: {},
                dropped_attributes_count: 0,
              },
            },
          });
        });

        return new Response(
          JSON.stringify({
            traces: largeSpansData,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return undefined;
    }),
  ],
};

export const MixedStatuses: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        const mixedData = [
          ...mockSpansData.slice(0, 2),
          ...errorSpansData.slice(0, 1),
          ...mockSpansData.slice(2),
        ];

        return new Response(
          JSON.stringify({
            traces: mixedData,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Handle logs API calls
      if (url.pathname.includes("/logs")) {
        const urlParams = new URLSearchParams(url.search);
        const filtersParam = urlParams.get("filters");

        if (filtersParam) {
          try {
            const filters = JSON.parse(filtersParam);
            const traceIdFilter = filters.filters?.find(
              (f: any) => f.key === "trace_id"
            );
            const traceId = traceIdFilter?.value;

            if (traceId) {
              const mixedData = [
                ...mockSpansData.slice(0, 2),
                ...errorSpansData.slice(0, 1),
                ...mockSpansData.slice(2),
              ];
              const span = mixedData.find(
                (s) => s.payload.span.trace_id === traceId
              );
              const spanId = span?.payload.span.id || "unknown";

              return new Response(
                JSON.stringify({
                  logs: generateMockLogs(traceId, spanId),
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          } catch (e) {
            console.error("Error parsing filters:", e);
          }
        }
      }

      return undefined;
    }),
  ],
};

// Nested spans for a single trace
const nestedTraceId = "nested_trace_123456789abcdef";
const nestedSpansData: OtelSpan[] = [
  // Root span
  createMockSpan({
    start_time: "2024-01-15 10:30:00.000000000",
    end_time: "2024-01-15 10:30:05.000000000",
    payload: {
      span: {
        duration_ns: "5000000000",
        trace_id: nestedTraceId,
        id: "root_span_001",
        parent_span_id: "",
        name: "handle_request",
        kind: "SERVER",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {},
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  // Child span 1
  createMockSpan({
    start_time: "2024-01-15 10:30:00.500000000",
    end_time: "2024-01-15 10:30:01.500000000",
    payload: {
      span: {
        duration_ns: "1000000000",
        trace_id: nestedTraceId,
        id: "child_span_001",
        parent_span_id: "root_span_001",
        name: "authenticate_user",
        kind: "INTERNAL",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {},
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  // Child span 2 (with children)
  createMockSpan({
    start_time: "2024-01-15 10:30:01.500000000",
    end_time: "2024-01-15 10:30:04.000000000",
    payload: {
      span: {
        duration_ns: "2500000000",
        trace_id: nestedTraceId,
        id: "child_span_002",
        parent_span_id: "root_span_001",
        name: "process_llm_request",
        kind: "CLIENT",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {},
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  // Grandchild span 1
  createMockSpan({
    start_time: "2024-01-15 10:30:01.600000000",
    end_time: "2024-01-15 10:30:02.000000000",
    payload: {
      span: {
        duration_ns: "400000000",
        trace_id: nestedTraceId,
        id: "grandchild_span_001",
        parent_span_id: "child_span_002",
        name: "prepare_prompt",
        kind: "INTERNAL",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {},
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  // Grandchild span 2
  createMockSpan({
    start_time: "2024-01-15 10:30:02.000000000",
    end_time: "2024-01-15 10:30:03.500000000",
    payload: {
      span: {
        duration_ns: "1500000000",
        trace_id: nestedTraceId,
        id: "grandchild_span_002",
        parent_span_id: "child_span_002",
        name: "call_anthropic_api",
        kind: "CLIENT",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {},
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
  // Child span 3
  createMockSpan({
    start_time: "2024-01-15 10:30:04.000000000",
    end_time: "2024-01-15 10:30:05.000000000",
    payload: {
      span: {
        duration_ns: "1000000000",
        trace_id: nestedTraceId,
        id: "child_span_003",
        parent_span_id: "root_span_001",
        name: "save_response",
        kind: "CLIENT",
        status_code: "OK",
        status_message: "",
        trace_state: "",
        flags: 0,
        dropped_attributes_count: 0,
        dropped_events_count: 0,
        dropped_links_count: 0,
        attributes: {},
        events: [],
        links: [],
      },
      resource: {
        attributes: {
          "service.name": "blink-agent",
        },
        dropped_attributes_count: 0,
      },
      scope: {
        name: "agent-tracer",
        version: "1.0.0",
        attributes: {},
        dropped_attributes_count: 0,
      },
    },
  }),
];

export const WithComplexAttributes: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/traces/spans")
      ) {
        const complexSpan = createMockSpan({
          payload: {
            span: {
              duration_ns: "3456789012",
              trace_id: "complex123456789abcdef0",
              id: "complex_span_001",
              parent_span_id: "",
              name: "complex_operation",
              kind: "SERVER",
              status_code: "OK",
              status_message: "",
              trace_state: "",
              flags: 0,
              dropped_attributes_count: 0,
              dropped_events_count: 0,
              dropped_links_count: 0,
              attributes: {
                "http.method": "POST",
                "http.route": "/api/chat",
                "http.status_code": 200,
                "user.id": "user_12345",
                "user.email": "test@example.com",
                "request.headers.user-agent": "Mozilla/5.0...",
                "request.body.size": 1024,
                "response.body.size": 4096,
                "db.query.count": 5,
                "cache.hit": true,
                "llm.model": "claude-3-5-sonnet-20241022",
                "llm.tokens.total": 2000,
              },
              events: [
                {
                  time: "2024-01-15 10:30:01.000000000",
                  name: "request.started",
                  dropped_attributes_count: 0,
                  attributes: {
                    message: "Starting request processing",
                  },
                },
                {
                  time: "2024-01-15 10:30:02.000000000",
                  name: "database.query",
                  dropped_attributes_count: 0,
                  attributes: {
                    query: "SELECT * FROM users",
                    rows: 10,
                  },
                },
                {
                  time: "2024-01-15 10:30:03.000000000",
                  name: "request.completed",
                  dropped_attributes_count: 0,
                  attributes: {
                    message: "Request processing completed",
                  },
                },
              ],
              links: [
                {
                  linked_trace_id: "linked123456789abcdef",
                  linked_span_id: "linked_span_001",
                  trace_state: "",
                  flags: 0,
                  dropped_attributes_count: 0,
                  attributes: {
                    link_type: "follows_from",
                  },
                },
              ],
            },
            resource: {
              attributes: {
                "service.name": "blink-agent",
                "service.version": "1.0.0",
                "deployment.environment": "production",
                "host.name": "agent-server-01",
                "host.type": "x86_64",
              },
              dropped_attributes_count: 0,
            },
            scope: {
              name: "agent-tracer",
              version: "1.0.0",
              attributes: {
                "instrumentation.name": "opentelemetry-js",
              },
              dropped_attributes_count: 0,
            },
          },
        });

        return new Response(
          JSON.stringify({
            traces: [complexSpan],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Handle logs API calls
      if (url.pathname.includes("/logs")) {
        const urlParams = new URLSearchParams(url.search);
        const filtersParam = urlParams.get("filters");

        if (filtersParam) {
          try {
            const filters = JSON.parse(filtersParam);
            const traceIdFilter = filters.filters?.find(
              (f: any) => f.key === "trace_id"
            );
            const traceId = traceIdFilter?.value;

            if (traceId) {
              return new Response(
                JSON.stringify({
                  logs: generateMockLogs(traceId, "complex_span_001"),
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          } catch (e) {
            console.error("Error parsing filters:", e);
          }
        }
      }

      return undefined;
    }),
  ],
};
