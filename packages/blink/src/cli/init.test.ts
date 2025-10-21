import { describe, it, expect } from "bun:test";
import { getFilesForTemplate } from "./init";
import { render, BLINK_COMMAND, makeTmpDir, KEY_CODES } from "./lib/terminal";
import { join } from "path";
import { readFile } from "fs/promises";

const getFile = (files: Record<string, string>, filename: string): string => {
  const fileContent = files[filename];
  if (fileContent === undefined) {
    throw new Error(`File ${filename} is undefined`);
  }
  return fileContent;
};

// Test helper for .env.local AI provider key behavior
function testAiProviderKeyBehavior(template: "scratch" | "slack-bot") {
  describe(".env.local AI provider key behavior", () => {
    it("should show AI provider placeholders when envLocal is empty", () => {
      const files = getFilesForTemplate(template, {
        packageName: "test-project",
        aiProvider: "anthropic",
        envLocal: [],
      });

      const envLocal = getFile(files, ".env.local");
      expect(envLocal).toContain("# OPENAI_API_KEY=");
      expect(envLocal).toContain("# ANTHROPIC_API_KEY=");
      expect(envLocal).toContain("# AI_GATEWAY_API_KEY=");
    });

    it("should not show AI provider placeholders when ANTHROPIC_API_KEY is provided", () => {
      const files = getFilesForTemplate(template, {
        packageName: "test-project",
        aiProvider: "anthropic",
        envLocal: [["ANTHROPIC_API_KEY", "sk-test-123"]],
      });

      const envLocal = getFile(files, ".env.local");
      expect(envLocal).toContain("ANTHROPIC_API_KEY=sk-test-123");
      expect(envLocal).not.toContain("# OPENAI_API_KEY=");
      expect(envLocal).not.toContain("# ANTHROPIC_API_KEY=");
      expect(envLocal).not.toContain("# AI_GATEWAY_API_KEY=");
    });

    it("should not show AI provider placeholders when OPENAI_API_KEY is provided", () => {
      const files = getFilesForTemplate(template, {
        packageName: "test-project",
        aiProvider: "openai",
        envLocal: [["OPENAI_API_KEY", "sk-test-456"]],
      });

      const envLocal = getFile(files, ".env.local");
      expect(envLocal).toContain("OPENAI_API_KEY=sk-test-456");
      expect(envLocal).not.toContain("# OPENAI_API_KEY=");
      expect(envLocal).not.toContain("# ANTHROPIC_API_KEY=");
      expect(envLocal).not.toContain("# AI_GATEWAY_API_KEY=");
    });

    it("should not show AI provider placeholders when AI_GATEWAY_API_KEY is provided", () => {
      const files = getFilesForTemplate(template, {
        packageName: "test-project",
        aiProvider: "vercel",
        envLocal: [["AI_GATEWAY_API_KEY", "gateway-key-789"]],
      });

      const envLocal = getFile(files, ".env.local");
      expect(envLocal).toContain("AI_GATEWAY_API_KEY=gateway-key-789");
      expect(envLocal).not.toContain("# OPENAI_API_KEY=");
      expect(envLocal).not.toContain("# ANTHROPIC_API_KEY=");
      expect(envLocal).not.toContain("# AI_GATEWAY_API_KEY=");
    });

    it("should preserve variable order from envLocal array", () => {
      const files = getFilesForTemplate(template, {
        packageName: "test-project",
        aiProvider: "anthropic",
        envLocal: [
          ["CUSTOM_VAR_1", "value1"],
          ["ANTHROPIC_API_KEY", "sk-test-123"],
          ["CUSTOM_VAR_2", "value2"],
        ],
      });

      const envLocal = getFile(files, ".env.local");
      if (!envLocal) {
        throw new Error("envLocal is undefined");
      }
      const customVar1Index = envLocal.indexOf("CUSTOM_VAR_1=value1");
      const apiKeyIndex = envLocal.indexOf("ANTHROPIC_API_KEY=sk-test-123");
      const customVar2Index = envLocal.indexOf("CUSTOM_VAR_2=value2");

      expect(customVar1Index).toBeLessThan(apiKeyIndex);
      expect(apiKeyIndex).toBeLessThan(customVar2Index);
    });
  });
}

describe("getFilesForTemplate", () => {
  describe("scratch template", () => {
    testAiProviderKeyBehavior("scratch");

    it("should render package.json with correct dependencies for anthropic provider", () => {
      const files = getFilesForTemplate("scratch", {
        packageName: "test-project",
        aiProvider: "anthropic",
        envLocal: [],
      });
      const packageJsonContent = getFile(files, "package.json");
      if (!packageJsonContent) {
        throw new Error("packageJson is undefined");
      }

      const packageJson = JSON.parse(packageJsonContent);
      expect(packageJson.name).toBe("test-project");
      expect(packageJson.devDependencies["@ai-sdk/anthropic"]).toBe("latest");
      expect(packageJson.devDependencies["@ai-sdk/openai"]).toBeUndefined();
    });

    it("should render package.json with correct dependencies for openai provider", () => {
      const files = getFilesForTemplate("scratch", {
        packageName: "test-project",
        aiProvider: "openai",
        envLocal: [],
      });

      const packageJson = JSON.parse(getFile(files, "package.json"));
      expect(packageJson.devDependencies["@ai-sdk/openai"]).toBe("latest");
      expect(packageJson.devDependencies["@ai-sdk/anthropic"]).toBeUndefined();
    });
  });

  describe("slack-bot template", () => {
    testAiProviderKeyBehavior("slack-bot");

    it("should show Slack placeholders when envLocal is empty", () => {
      const files = getFilesForTemplate("slack-bot", {
        packageName: "test-slack-bot",
        aiProvider: "anthropic",
        envLocal: [],
      });

      const envLocal = getFile(files, ".env.local");
      expect(envLocal).toContain("SLACK_BOT_TOKEN=xoxb-your-token-here");
      expect(envLocal).toContain(
        "SLACK_SIGNING_SECRET=your-signing-secret-here"
      );
    });

    it("should show Slack placeholders even when AI key is provided", () => {
      const files = getFilesForTemplate("slack-bot", {
        packageName: "test-slack-bot",
        aiProvider: "openai",
        envLocal: [["OPENAI_API_KEY", "sk-test-456"]],
      });

      const envLocal = getFile(files, ".env.local");
      expect(envLocal).toContain("SLACK_BOT_TOKEN=xoxb-your-token-here");
      expect(envLocal).toContain(
        "SLACK_SIGNING_SECRET=your-signing-secret-here"
      );
    });

    it("should render package.json with slack dependencies", () => {
      const files = getFilesForTemplate("slack-bot", {
        packageName: "test-slack-bot",
        aiProvider: "anthropic",
        envLocal: [],
      });

      const packageJson = JSON.parse(getFile(files, "package.json"));
      expect(packageJson.name).toBe("test-slack-bot");
      expect(packageJson.devDependencies["@slack/bolt"]).toBe("latest");
      expect(packageJson.devDependencies["@blink-sdk/slack"]).toBe("latest");
    });
  });

  describe("agent.ts template rendering", () => {
    it("should render agent.ts with anthropic provider", () => {
      const files = getFilesForTemplate("scratch", {
        packageName: "test-project",
        aiProvider: "anthropic",
        envLocal: [],
      });

      const agentTs = getFile(files, "agent.ts");
      expect(agentTs).toContain(
        'import { anthropic } from "@ai-sdk/anthropic"'
      );
      expect(agentTs).toContain('model: anthropic("claude-sonnet-4-5")');
      expect(agentTs).not.toContain("import { openai }");
    });

    it("should render agent.ts with openai provider", () => {
      const files = getFilesForTemplate("scratch", {
        packageName: "test-project",
        aiProvider: "openai",
        envLocal: [],
      });

      const agentTs = getFile(files, "agent.ts");
      expect(agentTs).toContain('import { openai } from "@ai-sdk/openai"');
      expect(agentTs).toContain('model: openai.chat("gpt-5")');
      expect(agentTs).not.toContain("import { anthropic }");
    });

    it("should render agent.ts with vercel provider fallback", () => {
      const files = getFilesForTemplate("scratch", {
        packageName: "test-project",
        aiProvider: "vercel",
        envLocal: [],
      });

      const agentTs = getFile(files, "agent.ts");
      expect(agentTs).toContain('model: "anthropic/claude-sonnet-4.5"');
    });
  });
});

describe("init command", () => {
  it("scratch template, happy path", async () => {
    await using tempDir = await makeTmpDir();
    using term = render(`${BLINK_COMMAND} init`, { cwd: tempDir.path });
    await term.waitUntil((screen) => screen.includes("Scratch"));
    // by default, the first option should be selected. Scratch is second in the list.
    expect(term.getScreen()).not.toContain("Basic agent with example tool");
    term.write(KEY_CODES.DOWN);
    await term.waitUntil((screen) =>
      screen.includes("Basic agent with example tool")
    );
    term.write(KEY_CODES.ENTER);
    await term.waitUntil((screen) =>
      screen.includes("Which AI provider do you want to use?")
    );
    term.write(KEY_CODES.ENTER);
    await term.waitUntil((screen) =>
      screen.includes("Enter your OpenAI API key:")
    );
    term.write("sk-test-123");
    term.write(KEY_CODES.ENTER);
    await term.waitUntil((screen) =>
      screen.includes("What package manager do you want to use?")
    );
    const screen = term.getScreen();
    expect(screen).toContain("Bun");
    expect(screen).toContain("NPM");
    expect(screen).toContain("PNPM");
    expect(screen).toContain("Yarn");
    term.write(KEY_CODES.ENTER);
    await term.waitUntil((screen) =>
      screen.includes("API key saved to .env.local")
    );
    await term.waitUntil((screen) => screen.includes("To get started, run:"));
    const envFilePath = join(tempDir.path, ".env.local");
    const envFileContent = await readFile(envFilePath, "utf-8");
    expect(envFileContent.split("\n")).toContain("OPENAI_API_KEY=sk-test-123");
  });
});
