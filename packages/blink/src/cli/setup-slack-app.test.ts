import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Client from "@blink.so/api";
import {
  captureStdout,
  createMockClient,
  KEY_CODES,
  mockIO,
} from "./lib/in-memory-cli";
import { makeTmpDir } from "./lib/terminal";
import {
  setupSlackApp,
  updateEnvCredentials,
  verifySlackSignature,
} from "./setup-slack-app";

describe("verifySlackSignature", () => {
  const signingSecret = "test_signing_secret_12345";

  function generateValidSignature(
    secret: string,
    timestamp: string,
    body: string
  ): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`v0:${timestamp}:${body}`);
    return `v0=${hmac.digest("hex")}`;
  }

  it("should return true for a valid signature", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: "event_callback", event: {} });
    const signature = generateValidSignature(signingSecret, timestamp, body);

    const result = verifySlackSignature(
      signingSecret,
      timestamp,
      body,
      signature
    );
    expect(result).toBe(true);
  });

  it("should return false for an invalid signature", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: "event_callback", event: {} });
    // Use a signature with the correct length (v0= + 64 hex chars for SHA256)
    const invalidSignature =
      "v0=0000000000000000000000000000000000000000000000000000000000000000";

    const result = verifySlackSignature(
      signingSecret,
      timestamp,
      body,
      invalidSignature
    );
    expect(result).toBe(false);
  });

  it("should return false for a request older than 5 minutes", () => {
    // Timestamp from 10 minutes ago
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const body = JSON.stringify({ type: "event_callback", event: {} });
    const signature = generateValidSignature(signingSecret, timestamp, body);

    const result = verifySlackSignature(
      signingSecret,
      timestamp,
      body,
      signature
    );
    expect(result).toBe(false);
  });

  it("should return false when signature does not match body", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const originalBody = JSON.stringify({ type: "event_callback", event: {} });
    const tamperedBody = JSON.stringify({
      type: "event_callback",
      event: { tampered: true },
    });
    const signature = generateValidSignature(
      signingSecret,
      timestamp,
      originalBody
    );

    const result = verifySlackSignature(
      signingSecret,
      timestamp,
      tamperedBody,
      signature
    );
    expect(result).toBe(false);
  });

  it("should return false when signing secret is wrong", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: "event_callback", event: {} });
    const signature = generateValidSignature("wrong_secret", timestamp, body);

    const result = verifySlackSignature(
      signingSecret,
      timestamp,
      body,
      signature
    );
    expect(result).toBe(false);
  });
});

describe("updateEnvCredentials", () => {
  it("should add credentials to an empty env file", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "", "utf-8");

    await updateEnvCredentials(
      envPath,
      "xoxb-test-token",
      "test-signing-secret"
    );

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("SLACK_BOT_TOKEN=xoxb-test-token");
    expect(content).toContain("SLACK_SIGNING_SECRET=test-signing-secret");
    expect(content).toContain("# Slack App credentials");
  });

  it("should add credentials to an env file with existing variables", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(
      envPath,
      "EXISTING_VAR=value\nANOTHER_VAR=another_value\n",
      "utf-8"
    );

    await updateEnvCredentials(
      envPath,
      "xoxb-test-token",
      "test-signing-secret"
    );

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("EXISTING_VAR=value");
    expect(content).toContain("ANOTHER_VAR=another_value");
    expect(content).toContain("SLACK_BOT_TOKEN=xoxb-test-token");
    expect(content).toContain("SLACK_SIGNING_SECRET=test-signing-secret");
  });

  it("should comment out existing Slack credentials", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(
      envPath,
      `EXISTING_VAR=value
SLACK_BOT_TOKEN=old-token
SLACK_SIGNING_SECRET=old-secret
ANOTHER_VAR=another_value
`,
      "utf-8"
    );

    await updateEnvCredentials(envPath, "xoxb-new-token", "new-signing-secret");

    const content = await readFile(envPath, "utf-8");

    // Old credentials should be commented out
    expect(content).toContain("# SLACK_BOT_TOKEN=old-token");
    expect(content).toContain("# SLACK_SIGNING_SECRET=old-secret");

    // New credentials should be present
    expect(content).toContain("SLACK_BOT_TOKEN=xoxb-new-token");
    expect(content).toContain("SLACK_SIGNING_SECRET=new-signing-secret");

    // Other variables should be preserved
    expect(content).toContain("EXISTING_VAR=value");
    expect(content).toContain("ANOTHER_VAR=another_value");
  });

  it("should not double-comment already commented credentials", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(
      envPath,
      `# SLACK_BOT_TOKEN=already_commented
SLACK_SIGNING_SECRET=active_secret
`,
      "utf-8"
    );

    await updateEnvCredentials(envPath, "xoxb-new-token", "new-secret");

    const content = await readFile(envPath, "utf-8");

    // Already commented should stay as is (not double-commented)
    expect(content).toContain("# SLACK_BOT_TOKEN=already_commented");
    expect(content).not.toContain("# # SLACK_BOT_TOKEN=already_commented");

    // Active credential should be commented out
    expect(content).toContain("# SLACK_SIGNING_SECRET=active_secret");

    // New credentials should be present
    expect(content).toContain("SLACK_BOT_TOKEN=xoxb-new-token");
    expect(content).toContain("SLACK_SIGNING_SECRET=new-secret");
  });

  it("should handle env file that does not exist", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    // Don't create the file - it doesn't exist

    await updateEnvCredentials(envPath, "xoxb-test-token", "test-secret");

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("SLACK_BOT_TOKEN=xoxb-test-token");
    expect(content).toContain("SLACK_SIGNING_SECRET=test-secret");
  });

  it("should only add bot token if signing secret is not provided", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "", "utf-8");

    await updateEnvCredentials(envPath, "xoxb-test-token", undefined);

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("SLACK_BOT_TOKEN=xoxb-test-token");
    expect(content).not.toContain("SLACK_SIGNING_SECRET=");
  });

  it("should only add signing secret if bot token is not provided", async () => {
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "", "utf-8");

    await updateEnvCredentials(envPath, undefined, "test-signing-secret");

    const content = await readFile(envPath, "utf-8");
    expect(content).not.toContain("SLACK_BOT_TOKEN=");
    expect(content).toContain("SLACK_SIGNING_SECRET=test-signing-secret");
  });
});

describe("setup slack-app command", () => {
  function callSetupSlackApp(directory: string) {
    const client = createMockClient();
    client.devhook.getUrl.mockResolvedValue("https://test.blink.so/devhook");
    // Mock devhook.listen to avoid WebSocket connections
    client.devhook.listen.mockImplementation(() => {
      return { dispose: () => {}, [Symbol.dispose]: () => {} };
    });
    return setupSlackApp(directory, {
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

    await callSetupSlackApp(tempDir.path);

    const output = await capture.getOutput();
    expect(output).toContain("No .env.local file found");
  });

  it("should prompt for app name when .env.local exists", async () => {
    using io = mockIO();
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    const setupPromise = callSetupSlackApp(tempDir.path);

    await io.stdout.waitUntil((screen) =>
      screen.includes("What should your Slack app be called?")
    );
    expect(await io.stdout.getOutput()).toContain(
      "What should your Slack app be called?"
    );

    // Cancel to end the test
    process.stdin.emit("data", KEY_CODES.CTRL_C);
    await setupPromise.catch(() => {});
  });

  it("should show URL and browser prompt after entering app name", async () => {
    using io = mockIO();
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    const setupPromise = callSetupSlackApp(tempDir.path);

    // Enter app name
    await io.stdout.waitUntil((screen) =>
      screen.includes("What should your Slack app be called?")
    );
    process.stdin.emit("data", "my-test-slack-app");
    process.stdin.emit("data", KEY_CODES.ENTER);

    // Should show URL and ask about opening browser
    await io.stdout.waitUntil((screen) =>
      screen.includes("Open this URL in your browser automatically?")
    );
    const output = await io.stdout.getOutput();
    expect(output).toContain("api.slack.com");
    expect(output).toContain("Open this URL in your browser automatically?");

    // Cancel to end the test
    process.stdin.emit("data", KEY_CODES.CTRL_C);
    await setupPromise.catch(() => {});
  });

  it("should prompt for App ID after declining to open browser", async () => {
    using io = mockIO();
    await using tempDir = await makeTmpDir();
    const envPath = join(tempDir.path, ".env.local");
    await writeFile(envPath, "SOME_VAR=value\n", "utf-8");

    const setupPromise = callSetupSlackApp(tempDir.path);

    // Enter app name
    await io.stdout.waitUntil((screen) =>
      screen.includes("What should your Slack app be called?")
    );
    process.stdin.emit("data", "my-test-slack-app");
    process.stdin.emit("data", KEY_CODES.ENTER);

    // Decline to open browser
    await io.stdout.waitUntil((screen) =>
      screen.includes("Open this URL in your browser automatically?")
    );
    // Move selection to "No" and confirm
    process.stdin.emit("data", KEY_CODES.LEFT);
    process.stdin.emit("data", KEY_CODES.ENTER);

    // Should prompt for App ID
    await io.stdout.waitUntil((screen) => screen.includes("paste the App ID"));
    expect(await io.stdout.getOutput()).toContain("App ID");

    // Cancel to end the test
    process.stdin.emit("data", KEY_CODES.CTRL_C);
    await setupPromise.catch(() => {});
  });
});
