import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LogDetailsSidebar } from "./log-details-sidebar";

type LogEntry = {
  timestamp: Date;
  original: string;
  message?: string;
  level: "info" | "error" | "warn";
} & ({ type: "text" } | { type: "json"; parsed: unknown });

const meta: Meta<typeof LogDetailsSidebar> = {
  title: "Components/LogDetailsSidebar",
  component: (props) => {
    const [isOpen, setIsOpen] = useState(props.isOpen);

    return (
      <div className="h-screen max-h-screen flex flex-col relative">
        <div className="p-6">
          <Button onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? "Close" : "Open"} Sidebar
          </Button>
        </div>
        <LogDetailsSidebar
          {...props}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        />
      </div>
    );
  },
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/test-org/test-agent/logs",
        query: {},
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const textLog: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:00.123Z"),
  original: "Failed to connect to database: Connection timeout after 5000ms",
  level: "error",
  type: "text",
};

const jsonLog: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:01.456Z"),
  original: JSON.stringify({
    message: "Database query completed successfully",
    duration_ms: 45,
    rows_returned: 1,
    query: "SELECT * FROM users WHERE id = $1",
    user_id: "user_12345",
  }),
  level: "info",
  type: "json",
  parsed: {
    message: "Database query completed successfully",
    duration_ms: 45,
    rows_returned: 1,
    query: "SELECT * FROM users WHERE id = $1",
    user_id: "user_12345",
  },
};

const jsonLogWithTraceInfo: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:02.789Z"),
  original: JSON.stringify({
    message: "Processing user request",
    trace_id: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    span_id: "span1234567890ab",
    request_id: "req_12345",
    user_agent: "Mozilla/5.0",
  }),
  level: "info",
  type: "json",
  parsed: {
    message: "Processing user request",
    trace_id: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    span_id: "span1234567890ab",
    request_id: "req_12345",
    user_agent: "Mozilla/5.0",
  },
};

const jsonLogWithOnlyTraceId: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:03.012Z"),
  original: JSON.stringify({
    message: "Background task started",
    trace_id: "trace789xyz123abc456def",
    task_type: "cleanup",
  }),
  level: "info",
  type: "json",
  parsed: {
    message: "Background task started",
    trace_id: "trace789xyz123abc456def",
    task_type: "cleanup",
  },
};

const jsonLogWithOnlySpanId: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:04.345Z"),
  original: JSON.stringify({
    message: "Cache operation completed",
    span_id: "span_cache_001",
    cache_key: "user:profile:12345",
    hit: true,
  }),
  level: "info",
  type: "json",
  parsed: {
    message: "Cache operation completed",
    span_id: "span_cache_001",
    cache_key: "user:profile:12345",
    hit: true,
  },
};

const complexJsonLog: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:05.678Z"),
  original: JSON.stringify({
    message: "Request completed with nested details",
    level: "info",
    request: {
      method: "POST",
      url: "/api/chat",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ***",
      },
    },
    response: {
      status_code: 200,
      body_size_bytes: 4096,
    },
    metadata: {
      user: {
        id: "user_789",
        profile: {
          name: "John Doe",
          email: "john@example.com",
        },
      },
      timing: {
        db_ms: 45,
        llm_ms: 1200,
        total_ms: 1300,
      },
    },
  }),
  level: "info",
  type: "json",
  parsed: {
    message: "Request completed with nested details",
    level: "info",
    request: {
      method: "POST",
      url: "/api/chat",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ***",
      },
    },
    response: {
      status_code: 200,
      body_size_bytes: 4096,
    },
    metadata: {
      user: {
        id: "user_789",
        profile: {
          name: "John Doe",
          email: "john@example.com",
        },
      },
      timing: {
        db_ms: 45,
        llm_ms: 1200,
        total_ms: 1300,
      },
    },
  },
};

const warnLog: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:06.901Z"),
  original: JSON.stringify({
    message: "API rate limit approaching (80% capacity)",
    warning_type: "rate_limit",
    current: 800,
    max: 1000,
    percentage: 80,
  }),
  level: "warn",
  type: "json",
  parsed: {
    message: "API rate limit approaching (80% capacity)",
    warning_type: "rate_limit",
    current: 800,
    max: 1000,
    percentage: 80,
  },
};

const errorLog: LogEntry = {
  timestamp: new Date("2024-01-15T10:30:07.234Z"),
  original: JSON.stringify({
    message: "Request failed with error",
    error: "Connection timeout after 5000ms",
    error_type: "TimeoutError",
    retry_count: 3,
    trace_id: "error_trace_123",
    span_id: "error_span_001",
  }),
  level: "error",
  type: "json",
  parsed: {
    message: "Request failed with error",
    error: "Connection timeout after 5000ms",
    error_type: "TimeoutError",
    retry_count: 3,
    trace_id: "error_trace_123",
    span_id: "error_span_001",
  },
};

export const Closed: Story = {
  args: {
    selectedLog: textLog,
    isOpen: false,
  },
};

export const TextLog: Story = {
  args: {
    selectedLog: textLog,
    isOpen: true,
  },
};

export const JsonLog: Story = {
  args: {
    selectedLog: jsonLog,
    isOpen: true,
  },
};

export const JsonLogWithTraceInfo: Story = {
  args: {
    selectedLog: jsonLogWithTraceInfo,
    isOpen: true,
  },
};

export const JsonLogWithOnlyTraceId: Story = {
  args: {
    selectedLog: jsonLogWithOnlyTraceId,
    isOpen: true,
  },
};

export const JsonLogWithOnlySpanId: Story = {
  args: {
    selectedLog: jsonLogWithOnlySpanId,
    isOpen: true,
  },
};

export const ComplexJsonLog: Story = {
  args: {
    selectedLog: complexJsonLog,
    isOpen: true,
  },
};

export const WarnLog: Story = {
  args: {
    selectedLog: warnLog,
    isOpen: true,
  },
};

export const ErrorLog: Story = {
  args: {
    selectedLog: errorLog,
    isOpen: true,
  },
};

export const NoLogSelected: Story = {
  args: {
    selectedLog: null,
    isOpen: true,
  },
};
