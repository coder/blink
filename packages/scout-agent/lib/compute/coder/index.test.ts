import { describe, expect, mock, test } from "bun:test";
import {
  baseCoderTestOptions,
  createMockCoderClient,
  createMockComputeServer,
  mockCoderPreset,
  mockCoderWorkspace,
  mockCoderWorkspaceBuild,
  noopLogger,
} from "../test-utils";
import { getCoderWorkspaceClient, initializeCoderWorkspace } from "./index";

describe("initializeCoderWorkspace", () => {
  describe("existing workspace - running state", () => {
    test("reuses running workspace with connected agent", async () => {
      using computeServer = createMockComputeServer();

      const mockClient = createMockCoderClient({
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toContain("already initialized");
      expect(result.workspaceInfo.workspaceId).toBe("ws-123");
      expect(result.workspaceInfo.agentName).toBe("main");
      expect(mockClient.createWorkspaceBuild).not.toHaveBeenCalled();
      expect(mockClient.createWorkspace).not.toHaveBeenCalled();
    });

    test("falls through to create new when agent not connected", async () => {
      using computeServer = createMockComputeServer();

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          // First call: existing workspace with disconnected agent
          if (getWorkspaceCallCount === 1) {
            return Promise.resolve(
              mockCoderWorkspace({
                latest_build: mockCoderWorkspaceBuild({
                  status: "running",
                  resources: [
                    {
                      id: "res-123",
                      name: "main",
                      type: "docker_container",
                      agents: [
                        {
                          id: "agent-123",
                          name: "main",
                          status: "disconnected",
                        },
                      ],
                    },
                  ],
                }),
              })
            );
          }
          // Subsequent calls: newly created workspace is running with connected agent
          return Promise.resolve(mockCoderWorkspace({ id: "ws-new" }));
        }),
        createWorkspace: mock(() =>
          Promise.resolve(mockCoderWorkspace({ id: "ws-new" }))
        ),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        {
          ...baseCoderTestOptions,
          template: "test-template",
          client: mockClient,
        },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" initialized.'
      );
      expect(mockClient.createWorkspace).toHaveBeenCalled();
    });
  });

  describe("existing workspace - stopped/stopping state", () => {
    test("starts stopped workspace", async () => {
      using computeServer = createMockComputeServer();

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          // First call returns stopped, subsequent calls return running
          if (getWorkspaceCallCount === 1) {
            return Promise.resolve(
              mockCoderWorkspace({
                latest_build: mockCoderWorkspaceBuild({ status: "stopped" }),
              })
            );
          }
          return Promise.resolve(mockCoderWorkspace());
        }),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" started and initialized.'
      );
      expect(mockClient.createWorkspaceBuild).toHaveBeenCalledWith("ws-123", {
        transition: "start",
      });
    });

    test("starts stopping workspace", async () => {
      using computeServer = createMockComputeServer();

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          if (getWorkspaceCallCount === 1) {
            return Promise.resolve(
              mockCoderWorkspace({
                latest_build: mockCoderWorkspaceBuild({ status: "stopping" }),
              })
            );
          }
          return Promise.resolve(mockCoderWorkspace());
        }),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" started and initialized.'
      );
      expect(mockClient.createWorkspaceBuild).toHaveBeenCalled();
    });
  });

  describe("existing workspace - starting/pending state", () => {
    test("waits for starting workspace", async () => {
      using computeServer = createMockComputeServer();

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          if (getWorkspaceCallCount === 1) {
            return Promise.resolve(
              mockCoderWorkspace({
                latest_build: mockCoderWorkspaceBuild({ status: "starting" }),
              })
            );
          }
          return Promise.resolve(mockCoderWorkspace());
        }),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" initialized.'
      );
      expect(mockClient.createWorkspaceBuild).not.toHaveBeenCalled();
    });

    test("waits for pending workspace", async () => {
      using computeServer = createMockComputeServer();

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          if (getWorkspaceCallCount === 1) {
            return Promise.resolve(
              mockCoderWorkspace({
                latest_build: mockCoderWorkspaceBuild({ status: "pending" }),
              })
            );
          }
          return Promise.resolve(mockCoderWorkspace());
        }),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" initialized.'
      );
      expect(mockClient.createWorkspaceBuild).not.toHaveBeenCalled();
    });
  });

  describe("existing workspace - terminal states (fall through to create new)", () => {
    test.each([
      "failed",
      "canceled",
      "canceling",
      "deleted",
      "deleting",
    ] as const)("creates new workspace when existing is %s", async (status) => {
      using computeServer = createMockComputeServer();

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          // First call: existing workspace in terminal state
          if (getWorkspaceCallCount === 1) {
            return Promise.resolve(
              mockCoderWorkspace({
                latest_build: mockCoderWorkspaceBuild({ status }),
              })
            );
          }
          // Subsequent calls: newly created workspace is running
          return Promise.resolve(mockCoderWorkspace({ id: "ws-new" }));
        }),
        createWorkspace: mock(() =>
          Promise.resolve(mockCoderWorkspace({ id: "ws-new" }))
        ),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        {
          ...baseCoderTestOptions,
          template: "test-template",
          client: mockClient,
        },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" initialized.'
      );
      expect(mockClient.createWorkspace).toHaveBeenCalled();
    });
  });

  describe("existing workspace - error handling", () => {
    test("creates new workspace when getWorkspace throws", async () => {
      using computeServer = createMockComputeServer();

      const warnLogs: unknown[] = [];
      const logger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnLogs.push(args),
      };

      let getWorkspaceCallCount = 0;
      const mockClient = createMockCoderClient({
        getWorkspace: mock(() => {
          getWorkspaceCallCount++;
          // First call: throws error (existing workspace check fails)
          if (getWorkspaceCallCount === 1) {
            return Promise.reject(new Error("Workspace not found"));
          }
          // Subsequent calls: newly created workspace is running
          return Promise.resolve(mockCoderWorkspace({ id: "ws-new" }));
        }),
        createWorkspace: mock(() =>
          Promise.resolve(mockCoderWorkspace({ id: "ws-new" }))
        ),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        logger,
        {
          ...baseCoderTestOptions,
          template: "test-template",
          client: mockClient,
        },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" initialized.'
      );
      expect(mockClient.createWorkspace).toHaveBeenCalled();
      expect(warnLogs.length).toBeGreaterThan(0);
    });
  });

  describe("new workspace creation", () => {
    test("creates new workspace when no existing workspace", async () => {
      using computeServer = createMockComputeServer();

      const mockClient = createMockCoderClient({
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      const result = await initializeCoderWorkspace(
        noopLogger,
        {
          ...baseCoderTestOptions,
          template: "test-template",
          client: mockClient,
        },
        undefined
      );

      expect(result.message).toBe(
        'Workspace "testuser/test-workspace" initialized.'
      );
      expect(mockClient.createWorkspace).toHaveBeenCalled();
      expect(mockClient.getTemplateByName).toHaveBeenCalledWith(
        "org-123",
        "test-template"
      );
    });

    test("throws error when template option is missing", async () => {
      const mockClient = createMockCoderClient();

      await expect(
        initializeCoderWorkspace(
          noopLogger,
          { ...baseCoderTestOptions, client: mockClient },
          undefined
        )
      ).rejects.toThrow("Template is required");
    });

    test("throws error when template not found", async () => {
      const mockClient = createMockCoderClient({
        getTemplateByName: mock(() => Promise.resolve(undefined)),
      });

      await expect(
        initializeCoderWorkspace(
          noopLogger,
          {
            ...baseCoderTestOptions,
            template: "nonexistent-template",
            client: mockClient,
          },
          undefined
        )
      ).rejects.toThrow("not found");
    });

    test("creates workspace with preset", async () => {
      using computeServer = createMockComputeServer();

      const mockClient = createMockCoderClient({
        getTemplateVersionPresets: mock(() =>
          Promise.resolve([
            mockCoderPreset({ ID: "preset-abc", Name: "my-preset" }),
            mockCoderPreset({ ID: "preset-def", Name: "other-preset" }),
          ])
        ),
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      await initializeCoderWorkspace(
        noopLogger,
        {
          ...baseCoderTestOptions,
          template: "test-template",
          presetName: "my-preset",
          client: mockClient,
        },
        undefined
      );

      expect(mockClient.createWorkspace).toHaveBeenCalledWith(
        "org-123",
        expect.objectContaining({
          template_version_preset_id: "preset-abc",
        })
      );
    });

    test("throws error when preset not found", async () => {
      const mockClient = createMockCoderClient({
        getTemplateVersionPresets: mock(() =>
          Promise.resolve([mockCoderPreset({ Name: "other-preset" })])
        ),
      });

      await expect(
        initializeCoderWorkspace(
          noopLogger,
          {
            ...baseCoderTestOptions,
            template: "test-template",
            presetName: "nonexistent-preset",
            client: mockClient,
          },
          undefined
        )
      ).rejects.toThrow("Preset 'nonexistent-preset' not found");
    });

    test("passes rich parameters to createWorkspace", async () => {
      using computeServer = createMockComputeServer();

      const mockClient = createMockCoderClient({
        getAppHost: mock(() =>
          Promise.resolve(`localhost:${computeServer.port}`)
        ),
      });

      await initializeCoderWorkspace(
        noopLogger,
        {
          ...baseCoderTestOptions,
          template: "test-template",
          richParameters: [
            { name: "cpu", value: "4" },
            { name: "memory", value: "8GB" },
          ],
          client: mockClient,
        },
        undefined
      );

      expect(mockClient.createWorkspace).toHaveBeenCalledWith(
        "org-123",
        expect.objectContaining({
          rich_parameter_values: [
            { name: "cpu", value: "4" },
            { name: "memory", value: "8GB" },
          ],
        })
      );
    });
  });
});

describe("getCoderWorkspaceClient", () => {
  test("throws when workspace not running", async () => {
    const mockClient = createMockCoderClient({
      getWorkspace: mock(() =>
        Promise.resolve(
          mockCoderWorkspace({
            latest_build: mockCoderWorkspaceBuild({ status: "stopped" }),
          })
        )
      ),
    });

    await expect(
      getCoderWorkspaceClient(
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      )
    ).rejects.toThrow("not running");
  });

  test("throws when agent not found", async () => {
    const mockClient = createMockCoderClient({
      getWorkspace: mock(() =>
        Promise.resolve(
          mockCoderWorkspace({
            latest_build: mockCoderWorkspaceBuild({
              resources: [
                {
                  id: "res-123",
                  name: "main",
                  type: "docker_container",
                  agents: [
                    {
                      id: "agent-other",
                      name: "other-agent",
                      status: "connected",
                    },
                  ],
                },
              ],
            }),
          })
        )
      ),
    });

    await expect(
      getCoderWorkspaceClient(
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "nonexistent-agent",
        }
      )
    ).rejects.toThrow("Agent not found");
  });

  test("throws when agent not connected", async () => {
    const mockClient = createMockCoderClient({
      getWorkspace: mock(() =>
        Promise.resolve(
          mockCoderWorkspace({
            latest_build: mockCoderWorkspaceBuild({
              resources: [
                {
                  id: "res-123",
                  name: "main",
                  type: "docker_container",
                  agents: [
                    {
                      id: "agent-123",
                      name: "main",
                      status: "disconnected",
                    },
                  ],
                },
              ],
            }),
          })
        )
      ),
    });

    await expect(
      getCoderWorkspaceClient(
        { ...baseCoderTestOptions, client: mockClient },
        {
          workspaceId: "ws-123",
          workspaceName: "test-workspace",
          ownerName: "testuser",
          agentName: "main",
        }
      )
    ).rejects.toThrow("not connected");
  });

  test("connects to running workspace via WebSocket", async () => {
    using wsServer = createMockComputeServer();

    const mockClient = createMockCoderClient({
      getAppHost: mock(() => Promise.resolve(`localhost:${wsServer.port}`)),
    });

    const client = await getCoderWorkspaceClient(
      {
        ...baseCoderTestOptions,
        client: mockClient,
      },
      {
        workspaceId: "ws-123",
        workspaceName: "test-workspace",
        ownerName: "testuser",
        agentName: "main",
      }
    );

    expect(client).toBeDefined();
  });

  test("sends auth headers in WebSocket connection", async () => {
    using wsServer = createMockComputeServer();

    const mockClient = createMockCoderClient({
      getAppHost: mock(() => Promise.resolve(`localhost:${wsServer.port}`)),
    });

    await getCoderWorkspaceClient(
      {
        coderUrl: "http://coder.example.com",
        sessionToken: "my-secret-token",
        computeServerPort: 22137,
        client: mockClient,
      },
      {
        workspaceId: "ws-123",
        workspaceName: "test-workspace",
        ownerName: "testuser",
        agentName: "main",
      }
    );

    const headers = wsServer.getReceivedHeaders();
    expect(headers["coder-session-token"]).toBe("my-secret-token");
    expect(headers.cookie).toContain("coder_session_token=my-secret-token");
  });
});
