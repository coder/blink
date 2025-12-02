import { describe, expect, mock, test } from "bun:test";
import { WebSocketServer } from "ws";
import type { DaytonaClient, DaytonaSandbox } from "./index";
import { getDaytonaWorkspaceClient, initializeDaytonaWorkspace } from "./index";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const createMockSandbox = (
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

const createMockDaytonaSdk = (
  sandbox: DaytonaSandbox = createMockSandbox()
): DaytonaClient => ({
  get: mock(() => Promise.resolve(sandbox)),
  create: mock(() => Promise.resolve(sandbox)),
});

const createMockWebSocketServer = () => {
  let receivedHeaders: Record<string, string> = {};
  const wss = new WebSocketServer({ port: 0 });
  const address = wss.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const url = `ws://localhost:${port}`;

  wss.on("connection", (_ws, req) => {
    receivedHeaders = req.headers as Record<string, string>;
  });

  return {
    url,
    getReceivedHeaders: () => receivedHeaders,
    [Symbol.dispose]: () => {
      wss.close();
    },
  };
};

describe("initializeDaytonaWorkspace", () => {
  test("creates new workspace when none exists", async () => {
    const mockSandbox = createMockSandbox({ id: "new-workspace-id" });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const result = await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      undefined
    );

    expect(result.workspaceInfo.id).toBe("new-workspace-id");
    expect(result.message).toBe("Workspace initialized.");
    expect(mockSdk.create).toHaveBeenCalledTimes(1);
    expect(mockSdk.create).toHaveBeenCalledWith({
      snapshot: "test-snapshot",
      autoDeleteInterval: 60,
      envVars: undefined,
      labels: undefined,
    });
    expect(mockSdk.get).not.toHaveBeenCalled();
  });

  test("reuses workspace in 'started' state", async () => {
    const mockSandbox = createMockSandbox({ state: "started" });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const result = await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      { id: "existing-workspace-id" }
    );

    expect(result.workspaceInfo.id).toBe("existing-workspace-id");
    expect(result.message).toInclude("already initialized");
    expect(result.message).toInclude("started");
    expect(mockSdk.get).toHaveBeenCalledTimes(1);
    expect(mockSdk.get).toHaveBeenCalledWith("existing-workspace-id");
    expect(mockSdk.create).not.toHaveBeenCalled();
  });

  test("reuses workspace in 'creating' state", async () => {
    const mockSandbox = createMockSandbox({ state: "creating" });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const result = await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      { id: "existing-workspace-id" }
    );

    expect(result.workspaceInfo.id).toBe("existing-workspace-id");
    expect(result.message).toInclude("already initialized");
    expect(result.message).toInclude("creating");
    expect(mockSdk.create).not.toHaveBeenCalled();
  });

  test("reuses workspace in 'starting' state", async () => {
    const mockSandbox = createMockSandbox({ state: "starting" });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const result = await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      { id: "existing-workspace-id" }
    );

    expect(result.workspaceInfo.id).toBe("existing-workspace-id");
    expect(result.message).toInclude("already initialized");
    expect(result.message).toInclude("starting");
    expect(mockSdk.create).not.toHaveBeenCalled();
  });

  test("creates new workspace when existing is stopped", async () => {
    const mockSandbox = createMockSandbox({
      id: "new-workspace-id",
      state: "stopped",
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const result = await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      { id: "existing-workspace-id" }
    );

    expect(result.workspaceInfo.id).toBe("new-workspace-id");
    expect(result.message).toBe("Workspace initialized.");
    expect(mockSdk.get).toHaveBeenCalledTimes(1);
    expect(mockSdk.create).toHaveBeenCalledTimes(1);
  });

  test("creates new workspace when get() throws", async () => {
    const mockSandbox = createMockSandbox({ id: "new-workspace-id" });
    const mockSdk: DaytonaClient = {
      get: mock(() => Promise.reject(new Error("Workspace not found"))),
      create: mock(() => Promise.resolve(mockSandbox)),
    };

    const warnLogs: unknown[] = [];
    const logger = {
      ...noopLogger,
      warn: (...args: unknown[]) => warnLogs.push(args),
    };

    const result = await initializeDaytonaWorkspace(
      logger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      { id: "non-existent-workspace" }
    );

    expect(result.workspaceInfo.id).toBe("new-workspace-id");
    expect(result.message).toBe("Workspace initialized.");
    expect(mockSdk.get).toHaveBeenCalledTimes(1);
    expect(mockSdk.create).toHaveBeenCalledTimes(1);
    expect(warnLogs.length).toBeGreaterThan(0);
    expect((warnLogs[0] as string[])[0]).toContain("non-existent-workspace");
  });

  test("uses default autoDeleteInterval of 60", async () => {
    const mockSandbox = createMockSandbox();
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        daytonaSdk: mockSdk,
      },
      undefined
    );

    expect(mockSdk.create).toHaveBeenCalledWith(
      expect.objectContaining({ autoDeleteInterval: 60 })
    );
  });

  test("passes custom autoDeleteInterval", async () => {
    const mockSandbox = createMockSandbox();
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        autoDeleteIntervalMinutes: 120,
        daytonaSdk: mockSdk,
      },
      undefined
    );

    expect(mockSdk.create).toHaveBeenCalledWith(
      expect.objectContaining({ autoDeleteInterval: 120 })
    );
  });

  test("passes envVars and labels to create", async () => {
    const mockSandbox = createMockSandbox();
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    await initializeDaytonaWorkspace(
      noopLogger,
      {
        daytonaApiKey: "test-api-key",
        snapshot: "test-snapshot",
        envVars: { NODE_ENV: "test", DEBUG: "true" },
        labels: { team: "platform", env: "testing" },
        daytonaSdk: mockSdk,
      },
      undefined
    );

    expect(mockSdk.create).toHaveBeenCalledWith({
      snapshot: "test-snapshot",
      autoDeleteInterval: 60,
      envVars: { NODE_ENV: "test", DEBUG: "true" },
      labels: { team: "platform", env: "testing" },
    });
  });
});

describe("getDaytonaWorkspaceClient", () => {
  test("connects to running workspace", async () => {
    using server = createMockWebSocketServer();
    const mockSandbox = createMockSandbox({
      state: "started",
      getPreviewLink: mock(() =>
        Promise.resolve({ url: server.url, token: "test-token" })
      ),
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const client = await getDaytonaWorkspaceClient(
      {
        daytonaApiKey: "test-api-key",
        computeServerPort: 3000,
        daytonaSdk: mockSdk,
      },
      { id: "test-workspace-id" }
    );

    expect(client).toBeDefined();
    expect(mockSdk.get).toHaveBeenCalledWith("test-workspace-id");
    expect(mockSandbox.getPreviewLink).toHaveBeenCalledWith(3000);
    expect(mockSandbox.start).not.toHaveBeenCalled();
  });

  test("starts stopped workspace before connecting", async () => {
    using server = createMockWebSocketServer();
    const mockSandbox = createMockSandbox({
      state: "stopped",
      getPreviewLink: mock(() =>
        Promise.resolve({ url: server.url, token: "test-token" })
      ),
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    const client = await getDaytonaWorkspaceClient(
      {
        daytonaApiKey: "test-api-key",
        computeServerPort: 3000,
        daytonaSdk: mockSdk,
      },
      { id: "test-workspace-id" }
    );

    expect(client).toBeDefined();
    expect(mockSandbox.start).toHaveBeenCalledTimes(1);
    expect(mockSandbox.start).toHaveBeenCalledWith(60);
  });

  test("passes auth token in WebSocket header", async () => {
    using server = createMockWebSocketServer();
    const mockSandbox = createMockSandbox({
      state: "started",
      getPreviewLink: mock(() =>
        Promise.resolve({ url: server.url, token: "secret-preview-token" })
      ),
    });
    const mockSdk = createMockDaytonaSdk(mockSandbox);

    await getDaytonaWorkspaceClient(
      {
        daytonaApiKey: "test-api-key",
        computeServerPort: 3000,
        daytonaSdk: mockSdk,
      },
      { id: "test-workspace-id" }
    );

    expect(server.getReceivedHeaders()["x-daytona-preview-token"]).toBe(
      "secret-preview-token"
    );
  });
});
