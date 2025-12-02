import { Button } from "@/components/ui/button";
import type { OtelSpan } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  SpanDetailsSidebar,
  tryParseJSON,
  type LogEntry,
} from "./span-details-sidebar";

// Helper to create mock logs for different scenarios
function createMockLogs(
  spanId: string,
  traceId: string,
  scenario: "basic" | "error" = "basic"
): LogEntry[] {
  const baseTime = new Date("2024-01-15T10:30:00.000Z");

  const rawLogs: Array<{
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

  if (scenario === "error") {
    rawLogs.push(
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
    rawLogs.push(
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

  // Convert raw logs to LogEntry format
  return rawLogs.map((log) => {
    const parseResult = tryParseJSON(log.message);
    return {
      timestamp: new Date(log.timestamp),
      message: log.message,
      level: log.level,
      original: log.message,
      type: parseResult.isJSON ? ("json" as const) : ("text" as const),
      parsed: parseResult.isJSON ? parseResult.data : undefined,
    };
  });
}

const meta: Meta<typeof SpanDetailsSidebar> = {
  title: "Components/SpanDetailsSidebar",
  component: (props) => {
    const [isOpen, setIsOpen] = useState(props.isOpen);

    return (
      <div className="h-screen max-h-screen flex flex-col relative">
        <div className="p-6">
          <Button onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? "Close" : "Open"} Sidebar
          </Button>
        </div>
        <SpanDetailsSidebar
          {...props}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        />
      </div>
    );
  },
  parameters: {
    layout: "fullscreen",
  },
  args: {
    agentId: "test-agent-123",
    logs: [],
    logsLoading: false,
    logsError: null,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const basicSpan: OtelSpan = {
  agent_id: "test-agent-123",
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
};

const spanWithParent: OtelSpan = {
  ...basicSpan,
  payload: {
    ...basicSpan.payload,
    span: {
      ...basicSpan.payload.span,
      parent_span_id: "parent1234567890",
      name: "execute_database_query",
      kind: "CLIENT",
    },
  },
};

const errorSpan: OtelSpan = {
  ...basicSpan,
  start_time: "2024-01-15 10:30:00.000000000",
  end_time: "2024-01-15 10:30:05.000000000",
  payload: {
    ...basicSpan.payload,
    span: {
      ...basicSpan.payload.span,
      duration_ns: "5000000000",
      trace_id: "error123456789abcdef",
      id: "error_span_001",
      name: "failed_database_connection",
      kind: "CLIENT",
      status_code: "ERROR",
      status_message: "Connection timeout after 5000ms",
      attributes: {
        "db.system": "postgresql",
        "error.type": "TimeoutError",
        "error.message": "Connection timeout",
      },
      events: [],
      links: [],
    },
  },
};

const spanWithEvents: OtelSpan = {
  ...basicSpan,
  payload: {
    ...basicSpan.payload,
    span: {
      ...basicSpan.payload.span,
      events: [
        {
          time: "2024-01-15 10:30:01.000000000",
          name: "request.started",
          dropped_attributes_count: 0,
          attributes: {
            message: "Starting request processing",
            user_id: "user_12345",
          },
        },
        {
          time: "2024-01-15 10:30:01.500000000",
          name: "database.query",
          dropped_attributes_count: 0,
          attributes: {
            query: "SELECT * FROM users WHERE id = $1",
            rows_returned: 1,
            duration_ms: 45,
          },
        },
        {
          time: "2024-01-15 10:30:02.000000000",
          name: "request.completed",
          dropped_attributes_count: 0,
          attributes: {
            message: "Request processing completed successfully",
            status_code: 200,
          },
        },
      ],
    },
  },
};

const spanWithLinks: OtelSpan = {
  ...basicSpan,
  payload: {
    ...basicSpan.payload,
    span: {
      ...basicSpan.payload.span,
      links: [
        {
          linked_trace_id: "linked123456789abcdef0",
          linked_span_id: "linked_span_001",
          trace_state: "",
          flags: 0,
          dropped_attributes_count: 0,
          attributes: {
            link_type: "follows_from",
          },
        },
        {
          linked_trace_id: "linked234567890bcdefg1",
          linked_span_id: "linked_span_002",
          trace_state: "",
          flags: 0,
          dropped_attributes_count: 0,
          attributes: {
            link_type: "child_of",
          },
        },
      ],
    },
  },
};

const complexSpan: OtelSpan = {
  ...basicSpan,
  payload: {
    ...basicSpan.payload,
    span: {
      ...basicSpan.payload.span,
      name: "complex_operation_with_many_details",
      attributes: {
        "http.method": "POST",
        "http.route": "/api/chat",
        "http.status_code": 200,
        "http.request.header.user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "http.request.body.size": 1024,
        "http.response.body.size": 4096,
        "user.id": "user_12345",
        "user.email": "test@example.com",
        "user.subscription": "premium",
        "db.system": "postgresql",
        "db.name": "blink_prod",
        "db.query.count": 5,
        "db.total_duration_ms": 123,
        "cache.hit": true,
        "cache.key": "user:12345:profile",
        "llm.model": "claude-3-5-sonnet-20241022",
        "llm.provider": "anthropic",
        "llm.tokens.prompt": 1500,
        "llm.tokens.completion": 500,
        "llm.tokens.total": 2000,
        "deployment.environment": "production",
        "deployment.region": "us-east-1",
      },
      events: [
        {
          time: "2024-01-15 10:30:00.500000000",
          name: "authentication.success",
          dropped_attributes_count: 0,
          attributes: {
            user_id: "user_12345",
            method: "jwt",
          },
        },
        {
          time: "2024-01-15 10:30:01.000000000",
          name: "database.query.start",
          dropped_attributes_count: 0,
          attributes: {
            query: "SELECT * FROM users WHERE id = $1",
          },
        },
        {
          time: "2024-01-15 10:30:01.123000000",
          name: "database.query.complete",
          dropped_attributes_count: 0,
          attributes: {
            rows: 1,
            duration_ms: 123,
          },
        },
        {
          time: "2024-01-15 10:30:01.500000000",
          name: "llm.request.start",
          dropped_attributes_count: 0,
          attributes: {
            model: "claude-3-5-sonnet-20241022",
            prompt_tokens: 1500,
          },
        },
        {
          time: "2024-01-15 10:30:02.400000000",
          name: "llm.request.complete",
          dropped_attributes_count: 0,
          attributes: {
            completion_tokens: 500,
            duration_ms: 900,
          },
        },
      ],
      links: [
        {
          linked_trace_id: "upstream123456789abcdef",
          linked_span_id: "upstream_span_001",
          trace_state: "",
          flags: 0,
          dropped_attributes_count: 0,
          attributes: {
            link_type: "follows_from",
            relation: "upstream_request",
          },
        },
      ],
    },
    resource: {
      attributes: {
        "service.name": "blink-agent",
        "service.version": "1.0.0",
        "service.instance.id": "agent-prod-01",
        "deployment.environment": "production",
        "host.name": "agent-server-01",
        "host.type": "x86_64",
        "host.arch": "amd64",
      },
      dropped_attributes_count: 0,
    },
    scope: {
      name: "agent-tracer",
      version: "1.0.0",
      attributes: {
        "instrumentation.name": "opentelemetry-js",
        "instrumentation.version": "1.20.0",
      },
      dropped_attributes_count: 0,
    },
  },
};

const unsetStatusSpan: OtelSpan = {
  ...basicSpan,
  payload: {
    ...basicSpan.payload,
    span: {
      ...basicSpan.payload.span,
      status_code: "UNSET",
      name: "background_task",
      kind: "INTERNAL",
    },
  },
};

export const Closed: Story = {
  args: {
    selectedSpan: basicSpan,
    isOpen: false,
    logs: createMockLogs(
      basicSpan.payload.span.id,
      basicSpan.payload.span.trace_id
    ),
  },
};

export const BasicSpan: Story = {
  args: {
    selectedSpan: basicSpan,
    isOpen: true,
    logs: createMockLogs(
      basicSpan.payload.span.id,
      basicSpan.payload.span.trace_id
    ),
  },
};

export const SpanWithParent: Story = {
  args: {
    selectedSpan: spanWithParent,
    isOpen: true,
    logs: createMockLogs(
      spanWithParent.payload.span.id,
      spanWithParent.payload.span.trace_id
    ),
  },
};

export const ErrorSpan: Story = {
  args: {
    selectedSpan: errorSpan,
    isOpen: true,
    logs: createMockLogs(
      errorSpan.payload.span.id,
      errorSpan.payload.span.trace_id,
      "error"
    ),
  },
};

export const UnsetStatus: Story = {
  args: {
    selectedSpan: unsetStatusSpan,
    isOpen: true,
    logs: createMockLogs(
      unsetStatusSpan.payload.span.id,
      unsetStatusSpan.payload.span.trace_id
    ),
  },
};

export const SpanWithEvents: Story = {
  args: {
    selectedSpan: spanWithEvents,
    isOpen: true,
    logs: createMockLogs(
      spanWithEvents.payload.span.id,
      spanWithEvents.payload.span.trace_id
    ),
  },
};

export const SpanWithLinks: Story = {
  args: {
    selectedSpan: spanWithLinks,
    isOpen: true,
    logs: createMockLogs(
      spanWithLinks.payload.span.id,
      spanWithLinks.payload.span.trace_id
    ),
  },
};

export const ComplexSpan: Story = {
  args: {
    selectedSpan: complexSpan,
    isOpen: true,
    logs: createMockLogs(
      complexSpan.payload.span.id,
      complexSpan.payload.span.trace_id
    ),
  },
};

export const NoSpanSelected: Story = {
  args: {
    selectedSpan: null,
    isOpen: true,
    logs: [],
  },
};
