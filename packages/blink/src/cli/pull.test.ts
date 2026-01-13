import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type Client from "@blink.so/api";
import {
  captureStdout,
  createMockClient,
  KEY_CODES,
  type MockedClient,
  mockIO,
} from "./lib/in-memory-cli";
import { makeTmpDir } from "./lib/terminal";
import pull from "./pull";

function createMockOrganization(overrides: { id: string; name: string }) {
  const now = new Date();
  return {
    id: overrides.id,
    name: overrides.name,
    created_at: now,
    updated_at: now,
    membership: null,
    members_url: `https://api.blink.so/organizations/${overrides.id}/members`,
    invites_url: `https://api.blink.so/organizations/${overrides.id}/invites`,
    avatar_url: null,
  };
}

function createMockAgent(overrides: {
  id: string;
  name: string;
  active_deployment_id?: string | null;
}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    organization_id: "org-1",
    created_at: now,
    updated_at: now,
    created_by: "user-1",
    name: overrides.name,
    description: null,
    avatar_url: null,
    visibility: "private" as const,
    active_deployment_id: overrides.active_deployment_id ?? null,
    pinned: false,
    request_url: null,
    chat_expire_ttl: null,
    onboarding_state: null,
    integrations_state: null,
  };
}

function createMockDeployment(overrides: {
  source_files: { id: string; path: string }[];
}) {
  const now = new Date().toISOString();
  return {
    id: "deploy-1",
    number: 1,
    created_at: now,
    updated_at: now,
    created_by: "user-1",
    created_from: "cli" as const,
    agent_id: "agent-1",
    source_files: overrides.source_files,
    output_files: [],
    status: "success" as const,
    target: "production" as const,
    error_message: null,
    user_message: null,
    platform: "lambda" as const,
    platform_memory_mb: 512,
    platform_region: null,
  };
}

describe("pull command", () => {
  let client: MockedClient;

  beforeEach(() => {
    client = createMockClient();
  });

  function callPull(agent?: string, dir?: string) {
    return pull(agent, {
      dir,
      _deps: {
        client: client as unknown as Client,
        authenticate: async () => "test-token",
      },
    });
  }

  /**
   * Sets up mocks for a successful pull scenario.
   * Individual tests can override specific mocks after calling this.
   */
  function setupMocks(options?: {
    orgName?: string;
    agentName?: string;
    activeDeploymentId?: string | null;
    sourceFiles?: { id: string; path: string }[];
    fileContents?: Record<string, string>;
  }) {
    const {
      orgName = "my-org",
      agentName = "my-agent",
      activeDeploymentId = "deploy-1",
      sourceFiles = [{ id: "file-1", path: "package.json" }],
      fileContents = { "file-1": "{}" },
    } = options ?? {};

    client.organizations.list.mockResolvedValue([
      createMockOrganization({ id: "org-1", name: orgName }),
    ]);

    client.organizations.agents.get.mockResolvedValue(
      createMockAgent({ id: "agent-1", name: agentName })
    );

    client.agents.get.mockResolvedValue(
      createMockAgent({
        id: "agent-1",
        name: agentName,
        active_deployment_id: activeDeploymentId,
      })
    );

    if (activeDeploymentId) {
      client.agents.deployments.get.mockResolvedValue(
        createMockDeployment({ source_files: sourceFiles })
      );

      client.files.get.mockImplementation(async (fileId: string) => {
        return new File([fileContents[fileId] ?? ""], "file");
      });
    }
  }

  it("should error when agent format is invalid", async () => {
    using capture = captureStdout();

    await expect(callPull("invalid-agent-format", "/tmp")).rejects.toThrow(
      "Agent must be in format: org-name/agent-name"
    );

    // Verify intro was shown before error
    expect(await capture.getOutput()).toContain("Pulling");
  });

  it("should return 1 when organization is not found", async () => {
    using capture = captureStdout();

    // Mock organizations.list to return empty array
    client.organizations.list.mockResolvedValue([]);

    const code = await callPull("my-org/my-agent", "/tmp");

    expect(code).toBe(1);
    const output = await capture.getOutput();
    expect(output).toContain("Organization");
    expect(output).toContain("not found");
  });

  it("should pull agent files to target directory", async () => {
    using capture = captureStdout();
    await using tempDir = await makeTmpDir();

    setupMocks({
      sourceFiles: [
        { id: "file-1", path: "agent.ts" },
        { id: "file-2", path: "package.json" },
      ],
      fileContents: {
        "file-1": 'export default { name: "test" };',
        "file-2": '{ "name": "test-agent" }',
      },
    });

    const code = await callPull("my-org/my-agent", tempDir.path);

    expect(code).toBe(0);
    const output = await capture.getOutput();
    expect(output).toContain("Pulling a Blink Agent");
    expect(output).toContain("my-org/my-agent");
    expect(existsSync(join(tempDir.path, "agent.ts"))).toBe(true);
    expect(existsSync(join(tempDir.path, "package.json"))).toBe(true);
  });

  it("should error when agent has no active deployment", async () => {
    using _capture = captureStdout();
    await using tempDir = await makeTmpDir();

    setupMocks({ activeDeploymentId: null });

    await expect(callPull("my-org/my-agent", tempDir.path)).rejects.toThrow(
      "Agent has no active deployment"
    );
  });

  it("should return 1 when agent is not found in organization", async () => {
    using capture = captureStdout();

    setupMocks();
    client.organizations.agents.get.mockRejectedValue(new Error("Not found"));

    const code = await callPull("my-org/my-agent", "/tmp");

    expect(code).toBe(1);
    const output = await capture.getOutput();
    expect(output).toContain("Agent");
    expect(output).toContain("not found");
  });

  it("should error when deployment has no source files", async () => {
    using _capture = captureStdout();
    await using tempDir = await makeTmpDir();

    setupMocks({ sourceFiles: [] });

    await expect(callPull("my-org/my-agent", tempDir.path)).rejects.toThrow(
      "No source files found in active deployment"
    );
  });

  it("should create nested directories for file paths", async () => {
    using _capture = captureStdout();
    await using tempDir = await makeTmpDir();

    setupMocks({
      sourceFiles: [
        { id: "file-1", path: "src/utils/helper.ts" },
        { id: "file-2", path: "src/components/deep/nested/Component.tsx" },
      ],
      fileContents: {
        "file-1": "export const helper = () => {};",
        "file-2": "export default function Component() {}",
      },
    });

    const code = await callPull("my-org/my-agent", tempDir.path);

    expect(code).toBe(0);
    expect(existsSync(join(tempDir.path, "src/utils/helper.ts"))).toBe(true);
    expect(
      existsSync(join(tempDir.path, "src/components/deep/nested/Component.tsx"))
    ).toBe(true);
  });

  it("should default to current working directory", async () => {
    using io = mockIO();

    setupMocks();

    // Call without dir option - should use cwd (which is non-empty)
    const pullPromise = callPull("my-org/my-agent");

    // Wait for confirm prompt, then reject it with LEFT + Enter
    await io.stdout.waitUntil((output) => output.includes("not empty"));
    process.stdin.emit("data", KEY_CODES.LEFT);
    process.stdin.emit("data", KEY_CODES.ENTER);

    const code = await pullPromise;
    expect(code).toBe(1); // Cancelled

    const output = await io.stdout.getOutput();
    expect(output).toContain(`Pulling a Blink Agent into`);
    expect(output).toContain(process.cwd());
  });

  it("should error when no organizations available (interactive mode)", async () => {
    using _capture = captureStdout();
    await using tempDir = await makeTmpDir();

    client.organizations.list.mockResolvedValue([]);

    await expect(callPull(undefined, tempDir.path)).rejects.toThrow(
      "You don't have access to any organizations"
    );
  });

  it("should auto-select single organization (interactive mode)", async () => {
    using capture = captureStdout();
    await using tempDir = await makeTmpDir();

    client.organizations.list.mockResolvedValue([
      createMockOrganization({ id: "org-1", name: "solo-org" }),
    ]);

    client.agents.list.mockResolvedValue({ items: [], has_more: false });

    // Will fail due to no agents, but we can check org selection
    await expect(callPull(undefined, tempDir.path)).rejects.toThrow();

    const output = await capture.getOutput();
    expect(output).toContain("Using organization:");
    expect(output).toContain("solo-org");
  });

  it("should error when no agents in organization (interactive mode)", async () => {
    using _capture = captureStdout();
    await using tempDir = await makeTmpDir();

    client.organizations.list.mockResolvedValue([
      createMockOrganization({ id: "org-1", name: "my-org" }),
    ]);

    client.agents.list.mockResolvedValue({ items: [], has_more: false });

    await expect(callPull(undefined, tempDir.path)).rejects.toThrow(
      'No agents found in organization "my-org"'
    );
  });

  it.each([
    { lockFile: "bun.lockb", install: "bun install", dev: "bun run dev" },
    {
      lockFile: "pnpm-lock.yaml",
      install: "pnpm install",
      dev: "pnpm run dev",
    },
    { lockFile: "yarn.lock", install: "yarn install", dev: "yarn dev" },
    { lockFile: "other.lock", install: "npm install", dev: "npm run dev" },
  ])(
    "should detect package manager from $lockFile",
    async ({ lockFile, install, dev }) => {
      using capture = captureStdout();
      await using tempDir = await makeTmpDir();

      const sourceFiles = [{ id: "file-1", path: "package.json" }];
      if (lockFile) {
        sourceFiles.push({ id: "file-2", path: lockFile });
      }

      setupMocks({ sourceFiles });

      await callPull("my-org/my-agent", tempDir.path);

      const output = await capture.getOutput();
      expect(output).toContain(install);
      expect(output).toContain(dev);
    }
  );
});
