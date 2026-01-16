import { describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Client from "@blink.so/api";
import type { GitHubAppData } from "../edit/tools/create-github-app";
import {
  captureStdout,
  createMockClient,
  KEY_CODES,
  mockIO,
} from "./lib/in-memory-cli";
import { makeTmpDir } from "./lib/terminal";
import { setupGithubApp, updateEnvCredentials } from "./setup-github-app";

const mockGitHubAppData: GitHubAppData = {
  id: 123456,
  client_id: "Iv1.abc123def456",
  client_secret: "secret_abc123",
  webhook_secret: "webhook_secret_xyz",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
  name: "test-github-app",
  html_url: "https://github.com/apps/test-github-app",
  slug: "test-github-app",
};

describe("updateEnvCredentials", () => {
  it("should add credentials to an empty env file", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "", "utf-8");

    await updateEnvCredentials(envPath, mockGitHubAppData);

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("GITHUB_APP_ID=123456");
    expect(content).toContain("GITHUB_CLIENT_ID=Iv1.abc123def456");
    expect(content).toContain("GITHUB_CLIENT_SECRET=secret_abc123");
    expect(content).toContain("GITHUB_WEBHOOK_SECRET=webhook_secret_xyz");
    expect(content).toContain("GITHUB_PRIVATE_KEY=");
    expect(content).toContain("# GitHub App credentials");
  });

  it("should add credentials to an env file with existing variables", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(
      envPath,
      "EXISTING_VAR=value\nANOTHER_VAR=another_value\n",
      "utf-8"
    );

    await updateEnvCredentials(envPath, mockGitHubAppData);

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("EXISTING_VAR=value");
    expect(content).toContain("ANOTHER_VAR=another_value");
    expect(content).toContain("GITHUB_APP_ID=123456");
  });

  it("should comment out existing GitHub App credentials", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(
      envPath,
      `EXISTING_VAR=value
GITHUB_APP_ID=old_id
GITHUB_CLIENT_ID=old_client_id
GITHUB_CLIENT_SECRET=old_secret
GITHUB_WEBHOOK_SECRET=old_webhook_secret
GITHUB_PRIVATE_KEY="old_key"
ANOTHER_VAR=another_value
`,
      "utf-8"
    );

    await updateEnvCredentials(envPath, mockGitHubAppData);

    const content = await readFile(envPath, "utf-8");

    // Old credentials should be commented out
    expect(content).toContain("# GITHUB_APP_ID=old_id");
    expect(content).toContain("# GITHUB_CLIENT_ID=old_client_id");
    expect(content).toContain("# GITHUB_CLIENT_SECRET=old_secret");
    expect(content).toContain("# GITHUB_WEBHOOK_SECRET=old_webhook_secret");
    expect(content).toContain('# GITHUB_PRIVATE_KEY="old_key"');

    // New credentials should be present
    expect(content).toContain("GITHUB_APP_ID=123456");
    expect(content).toContain("GITHUB_CLIENT_ID=Iv1.abc123def456");

    // Other variables should be preserved
    expect(content).toContain("EXISTING_VAR=value");
    expect(content).toContain("ANOTHER_VAR=another_value");
  });

  it("should not double-comment already commented credentials", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(
      envPath,
      `# GITHUB_APP_ID=already_commented
GITHUB_CLIENT_ID=active_client_id
`,
      "utf-8"
    );

    await updateEnvCredentials(envPath, mockGitHubAppData);

    const content = await readFile(envPath, "utf-8");

    // Already commented should stay as is (not double-commented)
    expect(content).toContain("# GITHUB_APP_ID=already_commented");
    expect(content).not.toContain("# # GITHUB_APP_ID=already_commented");

    // Active credential should be commented out
    expect(content).toContain("# GITHUB_CLIENT_ID=active_client_id");

    // New credentials should be present
    expect(content).toContain("GITHUB_APP_ID=123456");
  });

  it("should handle env file that does not exist", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    // Don't create the file - it doesn't exist

    await updateEnvCredentials(envPath, mockGitHubAppData);

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("GITHUB_APP_ID=123456");
  });

  it("should base64 encode the private key", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "", "utf-8");

    await updateEnvCredentials(envPath, mockGitHubAppData);

    const content = await readFile(envPath, "utf-8");
    const expectedBase64 = btoa(mockGitHubAppData.pem);
    expect(content).toContain(`GITHUB_PRIVATE_KEY="${expectedBase64}"`);
  });
});

describe("setup github-app command", () => {
  function callSetupGithubApp(directory: string) {
    const client = createMockClient();
    client.devhook.getUrl.mockResolvedValue("https://test.blink.so/devhook");
    return setupGithubApp(directory, {
      _deps: {
        authenticate: async () => {},
        getHost: () => "https://test.blink.so",
        client: client as unknown as Client,
      },
    });
  }

  it("should show error when .env.local does not exist", async () => {
    using capture = captureStdout();
    await using tempDir = await makeTmpDir();

    await callSetupGithubApp(tempDir.path);

    const output = await capture.getOutput();
    expect(output).toContain("No .env.local file found");
  });

  it("should prompt for app name when .env.local exists", async () => {
    using io = mockIO();
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    const setupPromise = callSetupGithubApp(tempDir.path);

    await io.stdout.waitUntil((screen) =>
      screen.includes("What should your GitHub App be called?")
    );
    expect(await io.stdout.getOutput()).toContain(
      "What should your GitHub App be called?"
    );

    // Cancel to end the test
    process.stdin.emit("data", KEY_CODES.CTRL_C);
    await setupPromise.catch(() => {});
  });

  it("should prompt for organization after entering app name", async () => {
    using io = mockIO();
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    const setupPromise = callSetupGithubApp(tempDir.path);

    await io.stdout.waitUntil((screen) =>
      screen.includes("What should your GitHub App be called?")
    );
    process.stdin.emit("data", "my-test-app");
    process.stdin.emit("data", KEY_CODES.ENTER);

    await io.stdout.waitUntil((screen) =>
      screen.includes("Enter a GitHub organization name")
    );
    const output = await io.stdout.getOutput();
    expect(output).toContain("Enter a GitHub organization name");
    expect(output).toContain("Leave blank for personal app");

    // Cancel to end the test
    process.stdin.emit("data", KEY_CODES.CTRL_C);
    await setupPromise.catch(() => {});
  });

  it("should show URL and browser prompt after organization input", async () => {
    using io = mockIO();
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    const setupPromise = callSetupGithubApp(tempDir.path);

    // Enter app name
    await io.stdout.waitUntil((screen) =>
      screen.includes("What should your GitHub App be called?")
    );
    process.stdin.emit("data", "my-test-app");
    process.stdin.emit("data", KEY_CODES.ENTER);

    // Skip organization (leave blank for personal app)
    await io.stdout.waitUntil((screen) =>
      screen.includes("Enter a GitHub organization name")
    );
    process.stdin.emit("data", KEY_CODES.ENTER);

    // Should show URL and ask about opening browser
    await io.stdout.waitUntil((screen) =>
      screen.includes("Open this URL in your browser automatically?")
    );
    const output = await io.stdout.getOutput();
    expect(output).toContain("http://127.0.0.1:");
    expect(output).toContain("Open this URL in your browser automatically?");

    // Cancel to end the test
    process.stdin.emit("data", KEY_CODES.CTRL_C);
    await setupPromise.catch(() => {});
  });
});
