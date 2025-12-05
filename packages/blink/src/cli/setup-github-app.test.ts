import { describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubAppData } from "../edit/tools/create-github-app";
import { BLINK_COMMAND, KEY_CODES, makeTmpDir, render } from "./lib/terminal";
import { updateEnvCredentials } from "./setup-github-app";

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
  it("should show error when .env.local does not exist", async () => {
    await using tempDir = await makeTmpDir();
    using term = render(`${BLINK_COMMAND} setup github-app`, {
      cwd: tempDir.path,
    });

    await term.waitUntil((screen) =>
      screen.includes("No .env.local file found")
    );
    expect(term.getScreen()).toContain("No .env.local file found");
  });

  it("should prompt for app name when .env.local exists", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    using term = render(`${BLINK_COMMAND} setup github-app`, {
      cwd: tempDir.path,
    });

    await term.waitUntil((screen) =>
      screen.includes("What should your GitHub App be called?")
    );
    expect(term.getScreen()).toContain(
      "What should your GitHub App be called?"
    );
  });

  it("should prompt for organization after entering app name", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    using term = render(`${BLINK_COMMAND} setup github-app`, {
      cwd: tempDir.path,
    });

    await term.waitUntil((screen) =>
      screen.includes("What should your GitHub App be called?")
    );
    term.write("my-test-app");
    term.write(KEY_CODES.ENTER);

    await term.waitUntil((screen) =>
      screen.includes("Enter a GitHub organization name")
    );
    expect(term.getScreen()).toContain("Enter a GitHub organization name");
    expect(term.getScreen()).toContain("Leave blank for personal app");
  });

  it("should show URL and browser prompt after organization input", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    using term = render(`${BLINK_COMMAND} setup github-app`, {
      cwd: tempDir.path,
    });

    // Enter app name
    await term.waitUntil((screen) =>
      screen.includes("What should your GitHub App be called?")
    );
    term.write("my-test-app");
    term.write(KEY_CODES.ENTER);

    // Skip organization (leave blank for personal app)
    await term.waitUntil((screen) =>
      screen.includes("Enter a GitHub organization name")
    );
    term.write(KEY_CODES.ENTER);

    // Should show URL and ask about opening browser
    await term.waitUntil((screen) =>
      screen.includes("Open this URL in your browser automatically?")
    );
    expect(term.getScreen()).toContain("http://127.0.0.1:");
    expect(term.getScreen()).toContain(
      "Open this URL in your browser automatically?"
    );
  });
});
