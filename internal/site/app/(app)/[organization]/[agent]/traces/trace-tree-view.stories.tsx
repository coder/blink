import { withFetch } from "@/.storybook/utils";
import type { OtelSpan } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { TraceTreeView } from "./trace-tree-view";

// Helper function to generate mock logs for a trace
function generateMockLogs(traceId: string) {
  const baseTime = new Date("2024-01-15T10:30:00.000Z");

  const logs = [
    // Root span logs
    {
      timestamp: new Date(baseTime.getTime() + 10).toISOString(),
      message: JSON.stringify({
        message: "Starting request processing",
        level: "info",
        span_id: "root001",
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 50).toISOString(),
      message: "Plain text log: Initializing connection pool",
      level: "info" as const,
    },
    // Child span 2 logs (process_llm_request)
    {
      timestamp: new Date(baseTime.getTime() + 2000).toISOString(),
      message: JSON.stringify({
        message: "Starting LLM request processing",
        level: "info",
        span_id: "child002",
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 4300).toISOString(),
      message: JSON.stringify({
        message: "LLM request completed",
        level: "info",
        span_id: "child002",
        trace_id: traceId,
        tokens: 1523,
      }),
      level: "info" as const,
    },
    // Grandchild span 1 logs (prepare_prompt)
    {
      timestamp: new Date(baseTime.getTime() + 2100).toISOString(),
      message: JSON.stringify({
        message: "Building prompt from template",
        level: "info",
        span_id: "grandchild001",
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 2300).toISOString(),
      message: JSON.stringify({
        message: "Prompt prepared successfully",
        level: "info",
        span_id: "grandchild001",
        trace_id: traceId,
        prompt_length: 2048,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 2400).toISOString(),
      message: JSON.stringify({
        message: "Validating prompt format",
        level: "warn",
        span_id: "grandchild001",
        trace_id: traceId,
      }),
      level: "warn" as const,
    },
    // Grandchild span 2 logs (call_anthropic_api)
    {
      timestamp: new Date(baseTime.getTime() + 2500).toISOString(),
      message: JSON.stringify({
        message: "Sending request to Anthropic API",
        level: "info",
        span_id: "grandchild002",
        trace_id: traceId,
        model: "claude-3-opus",
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 3000).toISOString(),
      message: JSON.stringify({
        message: "Streaming response from API",
        level: "info",
        span_id: "grandchild002",
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 3900).toISOString(),
      message: JSON.stringify({
        message: "API response completed",
        level: "info",
        span_id: "grandchild002",
        trace_id: traceId,
        duration_ms: 1400,
      }),
      level: "info" as const,
    },
    // Child span 3 logs (save_to_database) - with error
    {
      timestamp: new Date(baseTime.getTime() + 4500).toISOString(),
      message: JSON.stringify({
        message: "Attempting to save to database",
        level: "info",
        span_id: "child003",
        trace_id: traceId,
      }),
      level: "info" as const,
    },
    {
      timestamp: new Date(baseTime.getTime() + 4800).toISOString(),
      message: JSON.stringify({
        message: "Database connection timeout",
        level: "error",
        span_id: "child003",
        trace_id: traceId,
        error: "Connection timeout after 500ms",
      }),
      level: "error" as const,
    },
  ];

  return logs;
}

const meta: Meta<typeof TraceTreeView> = {
  title: "Components/TraceTreeView",
  component: ((props) => (
    <div className="h-screen flex flex-col">
      <TraceTreeView {...props} />
    </div>
  )) satisfies typeof TraceTreeView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    agentId: "test-agent-123",
    startTime: new Date("2024-01-15T10:29:00.000Z"),
    endTime: new Date("2024-01-15T10:31:00.000Z"),
    onBack: () => console.log("Back clicked"),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const traceId = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";

// Root span
const rootSpan: OtelSpan = {
  agent_id: "test-agent-123",
  start_time: "2024-01-15 10:30:00.000000000",
  end_time: "2024-01-15 10:30:05.000000000",
  payload: {
    span: {
      duration_ns: "5000000000",
      trace_id: traceId,
      id: "root001",
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
};

// Child span 1
const childSpan1: OtelSpan = {
  ...rootSpan,
  start_time: "2024-01-15 10:30:00.500000000",
  end_time: "2024-01-15 10:30:02.000000000",
  payload: {
    ...rootSpan.payload,
    span: {
      ...rootSpan.payload.span,
      duration_ns: "1500000000",
      id: "child001",
      parent_span_id: "root001",
      name: "authenticate_user",
      kind: "INTERNAL",
      status_code: "OK",
    },
  },
};

// Child span 2
const childSpan2: OtelSpan = {
  ...rootSpan,
  start_time: "2024-01-15 10:30:02.000000000",
  end_time: "2024-01-15 10:30:04.500000000",
  payload: {
    ...rootSpan.payload,
    span: {
      ...rootSpan.payload.span,
      duration_ns: "2500000000",
      id: "child002",
      parent_span_id: "root001",
      name: "process_llm_request",
      kind: "CLIENT",
      status_code: "OK",
    },
  },
};

// Grandchild span 1 (child of child002)
const grandchildSpan1: OtelSpan = {
  ...rootSpan,
  start_time: "2024-01-15 10:30:02.100000000",
  end_time: "2024-01-15 10:30:02.500000000",
  payload: {
    ...rootSpan.payload,
    span: {
      ...rootSpan.payload.span,
      duration_ns: "400000000",
      id: "grandchild001",
      parent_span_id: "child002",
      name: "prepare_prompt",
      kind: "INTERNAL",
      status_code: "OK",
    },
  },
};

// Grandchild span 2 (child of child002)
const grandchildSpan2: OtelSpan = {
  ...rootSpan,
  start_time: "2024-01-15 10:30:02.500000000",
  end_time: "2024-01-15 10:30:04.000000000",
  payload: {
    ...rootSpan.payload,
    span: {
      ...rootSpan.payload.span,
      duration_ns: "1500000000",
      id: "grandchild002",
      parent_span_id: "child002",
      name: "call_anthropic_api",
      kind: "CLIENT",
      status_code: "OK",
    },
  },
};

// Child span 3 with error
const childSpan3: OtelSpan = {
  ...rootSpan,
  start_time: "2024-01-15 10:30:04.500000000",
  end_time: "2024-01-15 10:30:05.000000000",
  payload: {
    ...rootSpan.payload,
    span: {
      ...rootSpan.payload.span,
      duration_ns: "500000000",
      id: "child003",
      parent_span_id: "root001",
      name: "save_to_database",
      kind: "CLIENT",
      status_code: "ERROR",
      status_message: "Connection timeout",
    },
  },
};

const simpleTraceSpans = [rootSpan, childSpan1, childSpan2];

const nestedTraceSpans = [
  rootSpan,
  childSpan1,
  childSpan2,
  grandchildSpan1,
  grandchildSpan2,
  childSpan3,
];

// Trace with multiple root spans (orphaned spans)
const orphanedSpan: OtelSpan = {
  ...rootSpan,
  start_time: "2024-01-15 10:30:00.000000000",
  end_time: "2024-01-15 10:30:01.000000000",
  payload: {
    ...rootSpan.payload,
    span: {
      ...rootSpan.payload.span,
      duration_ns: "1000000000",
      id: "orphan001",
      parent_span_id: "missing_parent",
      name: "orphaned_span",
      kind: "INTERNAL",
      status_code: "UNSET",
    },
  },
};

const traceWithOrphanedSpans = [rootSpan, childSpan1, orphanedSpan];

// Helper functions for mocking fetch calls
function createTracesResponse(spans: OtelSpan[]) {
  return new Response(JSON.stringify({ traces: spans }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createLogsResponse(url: URL) {
  const urlParams = new URLSearchParams(url.search);
  const filtersParam = urlParams.get("filters");
  if (filtersParam) {
    try {
      const filters = JSON.parse(filtersParam);
      const traceIdFilter = filters.filters?.find(
        (f: any) => f.key === "trace_id"
      );
      const traceIdValue = traceIdFilter?.value;
      if (traceIdValue) {
        return new Response(
          JSON.stringify({
            logs: generateMockLogs(traceIdValue),
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
  return undefined;
}

function createEmptyLogsResponse() {
  return new Response(JSON.stringify({ logs: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(
  spans: OtelSpan[],
  options: { withLogs?: boolean } = { withLogs: true }
) {
  return withFetch((url) => {
    if (url.pathname.includes("/traces/spans")) {
      return createTracesResponse(spans);
    }

    if (url.pathname.includes("/logs")) {
      return options.withLogs
        ? createLogsResponse(url)
        : createEmptyLogsResponse();
    }

    return undefined;
  });
}

export const SimpleTrace: Story = {
  args: {
    traceId,
  },
  decorators: [createMockFetch(simpleTraceSpans)],
};

export const NestedTrace: Story = {
  args: {
    traceId,
  },
  decorators: [createMockFetch(nestedTraceSpans)],
};

export const WithOrphanedSpans: Story = {
  args: {
    traceId,
  },
  decorators: [createMockFetch(traceWithOrphanedSpans, { withLogs: false })],
};

export const EmptyTrace: Story = {
  args: {
    traceId,
  },
  decorators: [createMockFetch([], { withLogs: false })],
};

export const Loading: Story = {
  args: {
    traceId,
  },
  decorators: [
    withFetch((url) => {
      if (url.pathname.includes("/traces/spans")) {
        // Return a promise that never resolves to simulate loading state
        return new Promise(() => {});
      }

      return undefined;
    }),
  ],
};
