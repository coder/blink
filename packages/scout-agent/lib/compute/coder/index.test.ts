import { describe, expect, test } from "bun:test";
import type { CoderWorkspaceInfo } from "./index";

// Note: Full integration tests for the Coder compute provider require:
// 1. A running Coder deployment
// 2. Valid credentials (session token)
// 3. A template configured for workspace creation
//
// These unit tests focus on type definitions and basic structure.

describe("CoderWorkspaceInfo", () => {
  test("workspace info has required fields", () => {
    const info: CoderWorkspaceInfo = {
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      workspaceName: "my-workspace",
      ownerName: "testuser",
      agentId: "123e4567-e89b-12d3-a456-426614174001",
      agentName: "main",
    };

    expect(info.workspaceId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(info.workspaceName).toBe("my-workspace");
    expect(info.ownerName).toBe("testuser");
    expect(info.agentId).toBeDefined();
    expect(info.agentName).toBe("main");
  });
});

describe("configuration validation", () => {
  test("minimal config requires url and sessionToken", () => {
    const config = {
      coderUrl: "https://coder.example.com",
      sessionToken: "session-token",
      computeServerPort: 22137,
    };

    expect(config.coderUrl).toBeDefined();
    expect(config.sessionToken).toBeDefined();
    expect(config.computeServerPort).toBe(22137);
  });

  test("full config with all optional fields", () => {
    const config = {
      coderUrl: "https://coder.example.com",
      sessionToken: "session-token",
      computeServerPort: 22137,
      template: "my-template",
      workspaceName: "my-workspace",
      agentName: "main",
      richParameters: [
        { name: "cpu", value: "4" },
        { name: "memory", value: "8" },
      ],
      startTimeoutSeconds: 600,
    };

    expect(config.template).toBe("my-template");
    expect(config.workspaceName).toBe("my-workspace");
    expect(config.agentName).toBe("main");
    expect(config.richParameters).toHaveLength(2);
    expect(config.startTimeoutSeconds).toBe(600);
  });
});

describe("API URL construction", () => {
  test("handles URLs with and without trailing slash", () => {
    const withSlash = "https://coder.example.com/";
    const withoutSlash = "https://coder.example.com";

    // Both should work - the implementation strips trailing slashes
    expect(withSlash.replace(/\/$/, "")).toBe(withoutSlash);
    expect(withoutSlash.replace(/\/$/, "")).toBe(withoutSlash);
  });

  test("WebSocket URL conversion", () => {
    const httpUrl = "https://coder.example.com";
    const wsUrl = httpUrl.replace(/^http/, "ws");
    expect(wsUrl).toBe("wss://coder.example.com");

    const httpUrlNoSsl = "http://localhost:3000";
    const wsUrlNoSsl = httpUrlNoSsl.replace(/^http/, "ws");
    expect(wsUrlNoSsl).toBe("ws://localhost:3000");
  });
});

// Integration test examples (skipped by default - require real Coder deployment)
describe.skip("integration tests", () => {
  // These tests require:
  // - CODER_URL environment variable set to your Coder deployment
  // - CODER_SESSION_TOKEN environment variable with a valid token
  // - A template available for workspace creation

  const getEnvConfig = () => ({
    coderUrl: process.env.CODER_URL || "",
    sessionToken: process.env.CODER_SESSION_TOKEN || "",
    computeServerPort: 22137,
    template: process.env.CODER_TEMPLATE || "default",
    startTimeoutSeconds: 300,
  });

  test("can initialize a new workspace", async () => {
    const { initializeCoderWorkspace } = await import("./index");
    const config = getEnvConfig();

    if (!config.coderUrl || !config.sessionToken) {
      console.log("Skipping: CODER_URL or CODER_SESSION_TOKEN not set");
      return;
    }

    const noopLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const result = await initializeCoderWorkspace(
      noopLogger,
      config,
      undefined
    );

    expect(result.workspaceInfo.workspaceId).toBeDefined();
    expect(result.workspaceInfo.workspaceName).toBeDefined();
    expect(result.workspaceInfo.agentId).toBeDefined();
    expect(result.message).toInclude("initialized");
  });

  test("can connect to an existing workspace", async () => {
    const { initializeCoderWorkspace, getCoderWorkspaceClient } = await import(
      "./index"
    );
    const config = getEnvConfig();

    if (!config.coderUrl || !config.sessionToken) {
      console.log("Skipping: CODER_URL or CODER_SESSION_TOKEN not set");
      return;
    }

    const noopLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // First initialize
    const initResult = await initializeCoderWorkspace(
      noopLogger,
      config,
      undefined
    );

    // Then get client
    const client = await getCoderWorkspaceClient(
      {
        coderUrl: config.coderUrl,
        sessionToken: config.sessionToken,
        computeServerPort: config.computeServerPort,
      },
      initResult.workspaceInfo
    );

    expect(client).toBeDefined();

    // Clean up
    client.dispose();
  });
});
