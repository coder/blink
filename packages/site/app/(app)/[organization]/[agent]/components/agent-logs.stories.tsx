import { withFetch } from "@/.storybook/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { AgentLogs, type AgentLogsProps } from "./agent-logs";

const meta: Meta<typeof AgentLogs> = {
  title: "Components/AgentLogs",
  component: (props: AgentLogsProps) => (
    <div className="h-screen max-h-screen">
      <AgentLogs {...props} />
    </div>
  ),
  parameters: {
    layout: "fullscreen",
  },
  args: {
    agentId: "test-agent-123",
    organizationId: "test-org-456",
    agentName: "Test Agent",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data for different log scenarios
const mockLogsData = [
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    message: "Agent started successfully",
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    message: JSON.stringify({
      message: {
        someField: "Nested message",
      },
    }),
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 8),
    message: JSON.stringify({
      event: "user_request",
      message: "Processing user request to create React component",
      request_id: "req_12345",
      trace_id: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
      span_id: "span1234567890ab",
      user: {
        id: "user_789",
        profile: {
          name: "John Doe",
          email: "john@example.com",
        },
      },
      action: "create_component",
      metadata: {
        type: "React",
        framework: "Next.js",
      },
    }),
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
    message: "Processing user request: Create a new React component",
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 12),
    message: JSON.stringify({
      level: "warning",
      service: "api_gateway",
      metrics: {
        rate_limit: {
          current: 800,
          max: 1000,
          percentage: 80,
        },
        requests: [
          { endpoint: "/api/chat", count: 450 },
          { endpoint: "/api/logs", count: 350 },
        ],
      },
      timestamp: "2024-01-15T10:30:00Z",
    }),
    level: "warn" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 15),
    message: "Warning: API rate limit approaching (80% capacity)",
    level: "warn" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 18),
    message: JSON.stringify({
      message: "Database connection failed after 3 retries",
      error: "database_connection_failed",
      trace_id: "trace_abc123def456",
      span_id: "span_error_db001",
      correlation: {
        trace_id: "trace_abc123",
        agents: [
          {
            id: "agent_001",
            deployment: {
              id: "deploy_xyz789",
              version: "1.2.3",
              region: "us-east-1",
            },
          },
          {
            id: "agent_002",
            deployment: {
              id: "deploy_def456",
              version: "1.2.2",
              region: "us-west-2",
            },
          },
        ],
      },
      details: {
        timeout_ms: 5000,
        retry_count: 3,
        last_error: "Connection refused",
      },
    }),
    level: "error" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 20),
    message: "Failed to connect to database: Connection timeout after 5000ms",
    level: "error" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 25),
    message: "Successfully generated code completion for user request",
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 28),
    message: JSON.stringify({
      message: "Search completed for 'React components' - found 15 files",
      event: "search_completed",
      query: "React components",
      trace_id: "search_trace_xyz789",
      results: {
        total_files: 15,
        matches: [
          { file: "src/components/Button.tsx", score: 0.95 },
          { file: "src/components/Modal.tsx", score: 0.87 },
          { file: "src/components/Form.tsx", score: 0.76 },
        ],
        execution_time_ms: 234,
      },
    }),
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    message: "Codebase search completed: Found 15 matching files",
    level: "info" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 35),
    message: "Error parsing user input: Invalid JSON syntax at line 12",
    level: "error" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 40),
    message: "Agent initialized with configuration: model=claude-3-5-sonnet",
    level: "info" as const,
  },
];

const searchResultsData = [
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    message: "Failed to connect to database: Connection timeout after 5000ms",
    level: "error" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
    message: JSON.stringify({
      error: "database_error",
      trace_id: "db_error_trace_001",
      span_id: "db_span_001",
      query: "SELECT * FROM logs WHERE agent_id = ?",
      parameters: ["agent_123"],
      connection: {
        host: "localhost",
        port: 5432,
        database: "blink_logs",
        ssl: false,
      },
      stack_trace: [
        "at DatabaseConnection.execute (db.js:45)",
        "at LogService.fetchLogs (logs.js:123)",
        "at AgentLogsController.getLogs (controller.js:67)",
      ],
    }),
    level: "error" as const,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 35),
    message: "Error parsing user input: Invalid JSON syntax at line 12",
    level: "error" as const,
  },
];

export const Default: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
      ) {
        return new Response(
          JSON.stringify({
            logs: mockLogsData,
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

export const Loading: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
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
        url.pathname.endsWith("/logs")
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
        url.pathname.endsWith("/logs")
      ) {
        return new Response("", {
          status: 500,
          statusText: "Network error: Unable to reach server",
          headers: { "Content-Type": "application/json" },
        });
      }
      return undefined;
    }),
  ],
};

export const EmptyLogs: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
      ) {
        return new Response(
          JSON.stringify({
            logs: [],
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

export const WithSearchResults: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
      ) {
        return new Response(
          JSON.stringify({
            logs: searchResultsData,
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

export const LargeDataset: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
      ) {
        // Mock fetch to return many log entries
        const largeMockData = Array.from({ length: 100 }, (_, i) => {
          let level: "error" | "warn" | "info";
          if (i % 10 === 0) {
            level = "error";
          } else if (i % 5 === 0) {
            level = "warn";
          } else {
            level = "info";
          }

          return {
            timestamp: new Date(Date.now() - 1000 * 60 * i),
            message: `Log entry ${i + 1}: ${
              i % 10 === 0
                ? "Critical system event occurred"
                : i % 5 === 0
                  ? "Warning: Performance degradation detected"
                  : `Regular operation completed successfully (batch ${Math.floor(i / 10) + 1})`
            }`,
            level,
          };
        });

        return new Response(
          JSON.stringify({
            logs: largeMockData,
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

export const OnlyErrors: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
      ) {
        const errorOnlyData = [
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 5),
            message:
              "Database connection failed: Cannot connect to postgres://localhost:5432",
            level: "error" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 8),
            message: JSON.stringify({
              error: "api_timeout",
              trace_id: "api_timeout_trace_456",
              span_id: "timeout_span_002",
              request: {
                method: "POST",
                url: "/api/chat",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: "Bearer ***",
                },
                body_size_bytes: 1024,
              },
              timeout: {
                configured_ms: 30000,
                actual_ms: 30001,
              },
              retries: {
                attempted: 3,
                max: 3,
              },
            }),
            level: "error" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 10),
            message:
              "API request timeout: Request to /api/chat took more than 30s",
            level: "error" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 15),
            message:
              "File upload failed: Maximum file size exceeded (10MB limit)",
            level: "error" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 18),
            message: JSON.stringify({
              error: "authentication_failed",
              token: {
                type: "JWT",
                issued_at: "2024-01-15T09:30:00Z",
                expires_at: "2024-01-15T10:30:00Z",
                issuer: "auth.blink.so",
              },
              validation: {
                signature_valid: false,
                claims_valid: true,
                expired: false,
              },
              client: {
                ip: "192.168.1.100",
                user_agent: "Mozilla/5.0...",
                session_id: "sess_abc123",
              },
            }),
            level: "error" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 20),
            message: "Authentication error: Invalid JWT token signature",
            level: "error" as const,
          },
        ];

        return new Response(
          JSON.stringify({
            logs: errorOnlyData,
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

export const MixedLevels: Story = {
  decorators: [
    withFetch((url) => {
      if (
        url.pathname.includes("/api/agents/") &&
        url.pathname.endsWith("/logs")
      ) {
        const mixedLevelData = [
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 2),
            message:
              "User session created: user_id=12345, session_duration=3600s",
            level: "info" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 3),
            message: JSON.stringify({
              event: "session_created",
              trace_id: "session_trace_789xyz",
              user: {
                id: "12345",
                email: "user@example.com",
                preferences: {
                  theme: "dark",
                  notifications: true,
                  language: "en",
                },
              },
              session: {
                id: "sess_xyz789",
                duration_s: 3600,
                created_at: "2024-01-15T10:00:00Z",
              },
            }),
            level: "info" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 4),
            message:
              "Cache miss: Rebuilding index for search query 'react components'",
            level: "warn" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 4.5),
            message: JSON.stringify({
              message: "Cache miss detected for search query",
              event: "cache_miss",
              query: "react components",
              cache: {
                hit_rate: 0.78,
                size_mb: 245,
                evictions: 12,
              },
              rebuild: {
                started_at: "2024-01-15T10:05:00Z",
                estimated_duration_s: 30,
                affected_queries: [
                  "react components",
                  "vue templates",
                  "angular directives",
                ],
              },
            }),
            level: "warn" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 5),
            message: JSON.stringify({
              event: "cache_statistics",
              cache: {
                hit_rate: 0.78,
                miss_rate: 0.22,
                size_mb: 245,
                evictions: 12,
                entries: 1542,
              },
              performance: {
                avg_lookup_ms: 2.3,
                max_lookup_ms: 45.7,
                total_requests: 8934,
              },
            }),
            level: "info" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 6),
            message: "Code execution completed: exit_code=0, duration=1.2s",
            level: "info" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 8),
            message: "Memory usage high: 85% of allocated heap used",
            level: "warn" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 9),
            message: JSON.stringify({
              alert: "health_check_failed",
              service: "chat-api",
              failures: {
                consecutive: 3,
                total_today: 7,
                threshold: 3,
              },
              checks: [
                {
                  timestamp: "2024-01-15T10:08:00Z",
                  status: "failed",
                  response_time_ms: null,
                  error: "Connection refused",
                },
                {
                  timestamp: "2024-01-15T10:07:30Z",
                  status: "failed",
                  response_time_ms: 30000,
                  error: "Timeout",
                },
                {
                  timestamp: "2024-01-15T10:07:00Z",
                  status: "failed",
                  response_time_ms: null,
                  error: "DNS resolution failed",
                },
              ],
            }),
            level: "error" as const,
          },
          {
            timestamp: new Date(Date.now() - 1000 * 60 * 10),
            message:
              "Critical: Service health check failed 3 consecutive times",
            level: "error" as const,
          },
        ];

        return new Response(
          JSON.stringify({
            logs: mixedLevelData,
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
