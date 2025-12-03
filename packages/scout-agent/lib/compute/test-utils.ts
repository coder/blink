import { mock } from "bun:test";
import * as http from "node:http";
import { Server as ComputeServer } from "@blink-sdk/compute-protocol/server";
import { WebSocketServer } from "ws";
import type { CoderApiClient } from "./coder/index";
import type { DaytonaClient, DaytonaSandbox } from "./daytona/index";

export const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Fast polling intervals for tests
export const TEST_POLLING_INTERVAL_MS = 10;
export const TEST_COMPUTE_SERVER_POLLING_INTERVAL_MS = 10;

// Base coder test options to avoid repetition
export const baseCoderTestOptions = {
  coderUrl: "http://coder.example.com",
  sessionToken: "test-token",
  computeServerPort: 22137,
  pollingIntervalMs: TEST_POLLING_INTERVAL_MS,
  computeServerPollingIntervalMs: TEST_COMPUTE_SERVER_POLLING_INTERVAL_MS,
} as const;

// ============================================================================
// Mock Compute Server
// ============================================================================

/**
 * Creates a mock compute server that handles both HTTP requests (for health checks)
 * and WebSocket connections (for compute protocol).
 */
export const createMockComputeServer = () => {
  // Create HTTP server that handles both regular requests and WebSocket upgrades
  const httpServer = http.createServer((_req, res) => {
    // Handle HTTP requests (e.g., health checks from coder's ensureComputeServer)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });

  const wss = new WebSocketServer({ server: httpServer });
  let receivedHeaders: Record<string, string> = {};

  wss.on("connection", (ws, req) => {
    receivedHeaders = req.headers as Record<string, string>;

    // Create the compute protocol server that sends responses via WebSocket
    const computeServer = new ComputeServer({
      send: (message: Uint8Array) => {
        ws.send(message);
      },
    });

    // Forward WebSocket messages to the compute server
    ws.on("message", (data: Buffer) => {
      computeServer.handleMessage(new Uint8Array(data));
    });
  });

  httpServer.listen(0);
  const address = httpServer.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const url = `ws://localhost:${port}`;

  return {
    url,
    port,
    getReceivedHeaders: () => receivedHeaders,
    [Symbol.dispose]: () => {
      wss.close();
      httpServer.close();
    },
  };
};

// ============================================================================
// Coder Mock Helpers
// ============================================================================

export const mockCoderWorkspaceBuild = (
  overrides: {
    status?:
      | "pending"
      | "starting"
      | "running"
      | "stopping"
      | "stopped"
      | "failed"
      | "canceling"
      | "canceled"
      | "deleting"
      | "deleted";
    resources?: Array<{
      id: string;
      name: string;
      type: string;
      agents?: Array<{
        id: string;
        name: string;
        status: "connecting" | "connected" | "disconnected" | "timeout";
      }>;
    }>;
  } = {}
) => ({
  id: "build-123",
  status: "running" as const,
  resources: [
    {
      id: "res-123",
      name: "main",
      type: "docker_container",
      agents: [
        {
          id: "agent-123",
          name: "main",
          status: "connected" as const,
        },
      ],
    },
  ],
  ...overrides,
});

export const mockCoderWorkspace = (
  overrides: {
    id?: string;
    name?: string;
    owner_name?: string;
    template_id?: string;
    template_name?: string;
    latest_build?: ReturnType<typeof mockCoderWorkspaceBuild>;
  } = {}
) => ({
  id: "ws-123",
  name: "test-workspace",
  owner_name: "testuser",
  template_id: "tmpl-123",
  template_name: "test-template",
  latest_build: mockCoderWorkspaceBuild(),
  ...overrides,
});

export const mockCoderTemplate = (
  overrides: {
    id?: string;
    name?: string;
    organization_id?: string;
    active_version_id?: string;
  } = {}
) => ({
  id: "tmpl-123",
  name: "test-template",
  organization_id: "org-123",
  active_version_id: "ver-123",
  ...overrides,
});

export const mockCoderPreset = (
  overrides: {
    ID?: string;
    Name?: string;
    Default?: boolean;
  } = {}
) => ({
  ID: "preset-123",
  Name: "default-preset",
  Default: true,
  ...overrides,
});

export const createMockCoderClient = (
  overrides: Partial<{
    sessionToken: string;
    getMe: () => Promise<{ id: string; username: string }>;
    getWorkspace: () => Promise<ReturnType<typeof mockCoderWorkspace>>;
    getWorkspaceByOwnerAndName: () => Promise<
      ReturnType<typeof mockCoderWorkspace> | undefined
    >;
    getTemplateByName: () => Promise<
      ReturnType<typeof mockCoderTemplate> | undefined
    >;
    getDefaultOrganization: () => Promise<{ id: string; name: string }>;
    createWorkspace: () => Promise<ReturnType<typeof mockCoderWorkspace>>;
    createWorkspaceBuild: () => Promise<
      ReturnType<typeof mockCoderWorkspaceBuild>
    >;
    getAppHost: () => Promise<string>;
    getTemplateVersionPresets: () => Promise<
      Array<ReturnType<typeof mockCoderPreset>>
    >;
  }> = {}
) =>
  ({
    sessionToken: "test-token",
    getMe: mock(() =>
      Promise.resolve({ id: "user-123", username: "testuser" })
    ),
    getWorkspace: mock(() => Promise.resolve(mockCoderWorkspace())),
    getWorkspaceByOwnerAndName: mock(() =>
      Promise.resolve(mockCoderWorkspace())
    ),
    getTemplateByName: mock(() => Promise.resolve(mockCoderTemplate())),
    getDefaultOrganization: mock(() =>
      Promise.resolve({ id: "org-123", name: "default" })
    ),
    createWorkspace: mock(() => Promise.resolve(mockCoderWorkspace())),
    createWorkspaceBuild: mock(() =>
      Promise.resolve(mockCoderWorkspaceBuild())
    ),
    getAppHost: mock(() => Promise.resolve("*.apps.coder.example.com")),
    getTemplateVersionPresets: mock(() => Promise.resolve([])),
    ...overrides,
  }) as unknown as CoderApiClient;

// ============================================================================
// Daytona Mock Helpers
// ============================================================================

export const createMockDaytonaSandbox = (
  overrides: Partial<DaytonaSandbox> = {}
): DaytonaSandbox => ({
  id: "test-workspace-id",
  state: "started",
  start: mock(() => Promise.resolve()),
  getPreviewLink: mock(() =>
    Promise.resolve({ url: "ws://localhost:9999", token: "test-token" })
  ),
  ...overrides,
});

export const createMockDaytonaSdk = (
  sandbox: DaytonaSandbox = createMockDaytonaSandbox()
): DaytonaClient => ({
  get: mock(() => Promise.resolve(sandbox)),
  create: mock(() => Promise.resolve(sandbox)),
});
