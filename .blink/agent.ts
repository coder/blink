import * as compute from "@blink-sdk/compute";
import * as github from "@blink-sdk/github";
import * as webSearch from "@blink-sdk/web-search";
import { convertToModelMessages, streamText, tool, type Tool } from "ai";
import * as blink from "blink";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { executeTool, type ToolExecuteFunction } from "@ai-sdk/provider-utils";
import { spawn } from "node:child_process";

const agent = blink.agent<
  blink.WithUIOptions<{
    model: "gpt-5" | "sonnet";
  }>
>();

const REPO_ROOT = (() => {
  let currentDir = process.cwd();
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, ".git"))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return undefined;
})();

agent.on("chat", async ({ messages, abortSignal }) => {
  const tools = {
    ...compute.tools,
    ...github.tools,
    ...webSearch.tools,
    ...(await blink.tools.withApproval({
      messages,
      tools: {
        publish: tool({
          description:
            "Publish a package to npm. Works with any package directory in the monorepo. Checks npm version, auto-bumps using semver if needed, runs tests, builds, packs, and publishes. Requires approval before executing.",
          inputSchema: z.object({
            packageDir: z
              .string()
              .optional()
              .describe(
                "The package directory to publish (e.g., 'packages/blink', 'packages/sdk/compute'). If not provided, uses current directory."
              ),
          }),
          execute: async ({ packageDir }, { abortSignal }) => {
            // Determine package directory
            const pkgDir = packageDir
              ? join(REPO_ROOT!, packageDir)
              : process.cwd();

            const output: string[] = [];
            output.push(`📦 Publishing from: ${pkgDir}`);

            // Read package.json
            const packageJsonPath = join(pkgDir, "package.json");
            if (!existsSync(packageJsonPath)) {
              throw new Error(`No package.json found at ${packageJsonPath}`);
            }

            const packageJson = JSON.parse(
              readFileSync(packageJsonPath, "utf-8")
            );
            const currentVersion = packageJson.version;
            const packageName = packageJson.name;

            output.push(`📋 Package: ${packageName}`);
            output.push(`📌 Current version: ${currentVersion}`);
            output.push("");

            // Helper to run command
            const runCommand = async (
              command: string,
              args: string[],
              cwd: string
            ): Promise<{ stdout: string; stderr: string }> => {
              return new Promise((resolve, reject) => {
                const proc = spawn(command, args, {
                  cwd,
                  stdio: ["ignore", "pipe", "pipe"],
                });

                let stdout = "";
                let stderr = "";

                proc.stdout?.on("data", (data) => {
                  stdout += data.toString();
                });

                proc.stderr?.on("data", (data) => {
                  stderr += data.toString();
                });

                proc.on("close", (code) => {
                  if (code === 0) {
                    resolve({ stdout, stderr });
                  } else {
                    reject(
                      new Error(
                        `Command failed with exit code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`
                      )
                    );
                  }
                });

                if (abortSignal) {
                  abortSignal.addEventListener("abort", () => proc.kill());
                }
              });
            };

            // Check published version on npm
            output.push("🔍 Checking npm registry...");
            let publishedVersion: string | null = null;
            try {
              const result = await runCommand(
                "npm",
                ["view", packageName, "versions", "--json"],
                pkgDir
              );
              const versions = JSON.parse(result.stdout.trim() || "[]");
              if (Array.isArray(versions) && versions.length > 0) {
                // Get the highest version from all published versions
                publishedVersion = versions[versions.length - 1];
              } else if (typeof versions === "string") {
                // Single version returns as string, not array
                publishedVersion = versions;
              } else {
                publishedVersion = null;
              }
            } catch (err: any) {
              if (err.message.includes("E404") || err.message.includes("404")) {
                publishedVersion = null; // Package not published
              } else {
                throw err;
              }
            }

            // Semver validation and bumping
            const parseSemver = (v: string) => {
              const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
              if (!match) throw new Error(`Invalid semver: ${v}`);
              return {
                major: parseInt(match[1]!),
                minor: parseInt(match[2]!),
                patch: parseInt(match[3]!),
              };
            };

            const compareSemver = (a: string, b: string) => {
              const vA = parseSemver(a);
              const vB = parseSemver(b);
              if (vA.major !== vB.major) return vA.major - vB.major;
              if (vA.minor !== vB.minor) return vA.minor - vB.minor;
              return vA.patch - vB.patch;
            };

            let targetVersion = currentVersion;
            let needsVersionUpdate = false;

            if (!publishedVersion) {
              output.push("✨ Package not yet published on npm");
              output.push(
                `📌 Will publish as first version: ${currentVersion}`
              );
              output.push("");
            } else {
              output.push(`📊 Published version: ${publishedVersion}`);

              const comparison = compareSemver(
                currentVersion,
                publishedVersion
              );
              if (comparison <= 0) {
                // Current version is <= published, need to bump from published
                const published = parseSemver(publishedVersion);
                targetVersion = `${published.major}.${published.minor}.${published.patch + 1}`;
                output.push(
                  `⚠️  Current version (${currentVersion}) is not ahead of published (${publishedVersion})`
                );
                output.push(`🔼 Will auto-bump to ${targetVersion}`);
                needsVersionUpdate = true;
              } else {
                output.push("✓ Version is ahead of published, proceeding");
              }
              output.push("");
            }

            // Run tests
            output.push("\n▶️  Running tests");
            output.push(`   $ bun test`);
            output.push("");
            const testResult = await runCommand("bun", ["test"], REPO_ROOT!);
            // Include last few lines of test output
            const testLines = testResult.stdout
              .split("\n")
              .filter((l) => l.trim());
            output.push(...testLines.slice(-5));
            output.push("✓ Tests passed");
            output.push("");

            // Update package.json if needed (do this AFTER tests pass)
            if (needsVersionUpdate) {
              packageJson.version = targetVersion;
              const fs = await import("node:fs/promises");
              await fs.writeFile(
                packageJsonPath,
                JSON.stringify(packageJson, null, 2) + "\n"
              );
              output.push(`🔼 Bumped version to ${targetVersion}`);
              output.push("");
            }

            // Build
            output.push("▶️  Building package");
            output.push(`   $ bun run build`);
            output.push("");
            await runCommand("bun", ["run", "build"], pkgDir);
            output.push("✓ Build complete");
            output.push("");

            // Pack
            output.push("▶️  Packing package");
            output.push(`   $ npm pack`);
            output.push("");
            const packResult = await runCommand("npm", ["pack"], pkgDir);
            output.push(packResult.stdout.trim());
            output.push("✓ Package packed");
            output.push("");

            // Publish
            output.push("▶️  Publishing to npm");
            output.push(`   $ npm publish`);
            output.push("");
            const publishResult = await runCommand("npm", ["publish"], pkgDir);
            output.push(publishResult.stdout.trim());
            output.push("✓ Published to npm");
            output.push("");

            output.push(
              `🎉 Successfully published ${packageName}@${targetVersion}`
            );

            return { success: true, output: output.join("\n") };
          },
        }),
      },
    })),

    dev_install_cli: tool({
      description:
        "Install the development version of the blink CLI globally. This builds the blink package from source and installs it globally, replacing any existing global blink installation. Use this when you need to test CLI changes.",
      inputSchema: z.object({}),
      execute: async (_, { abortSignal }) => {
        const result = await doToolExecute(
          compute.tools.execute_bash.execute!,
          {
            command: "cd packages/blink && bun run dev-install",
            working_directory: REPO_ROOT,
            env: {},
          },
          { abortSignal }
        );
        return result;
      },
    }),
    run_tests: tool({
      description:
        "Run the test suite using bun test. Returns success or failure with output.",
      inputSchema: z.object({}),
      execute: async (_, { abortSignal }) => {
        const pid = (await doToolExecute(
          compute.tools.execute_bash.execute!,
          { command: "bun test", working_directory: REPO_ROOT, env: {} },
          { abortSignal }
        )) as any;
        const result = (await doToolExecute(
          compute.tools.process_wait.execute!,
          { pid: pid.pid },
          { abortSignal }
        )) as any;

        if (result.exitCode !== 0) {
          return {
            success: false,
            output: result.plainOutput.lines.join("\n"),
          };
        }
        return { success: true, output: "All tests passed" };
      },
    }),
    run_format: tool({
      description:
        "Run the formatter using bun run format. Returns success or failure with output.",
      inputSchema: z.object({}),
      execute: async (_, { abortSignal }) => {
        const pid = (await doToolExecute(
          compute.tools.execute_bash.execute!,
          {
            command: "bun run format",
            working_directory: REPO_ROOT,
            env: {},
          },
          { abortSignal }
        )) as any;
        const result = (await doToolExecute(
          compute.tools.process_wait.execute!,
          { pid: pid.pid },
          { abortSignal }
        )) as any;

        if (result.exitCode !== 0) {
          return {
            success: false,
            output: result.plainOutput.lines.join("\n"),
          };
        }
        return { success: true, output: "Formatting complete" };
      },
    }),
    run_typecheck: tool({
      description:
        "Run TypeScript type checking using bun run typecheck. Returns success or failure with output.",
      inputSchema: z.object({}),
      execute: async (_, { abortSignal }) => {
        const pid = (await doToolExecute(
          compute.tools.execute_bash.execute!,
          {
            command: "bun run typecheck",
            working_directory: REPO_ROOT,
            env: {},
          },
          { abortSignal }
        )) as any;
        const result = (await doToolExecute(
          compute.tools.process_wait.execute!,
          { pid: pid.pid },
          { abortSignal }
        )) as any;

        const output = result.plainOutput.lines.join("\n");
        // Check if there are actual type errors (not just the command echo)
        const hasErrors =
          output.includes("error TS") ||
          (result.exitCode !== 0 && output.length > 100);

        if (hasErrors) {
          return { success: false, output };
        }
        return { success: true, output: "Type checking passed" };
      },
    }),
    git_commit: tool({
      description:
        "Create a git commit with the specified message. The agent MUST provide a commit message that accurately describes what THEY changed in edit mode. ONLY use this when the user explicitly asks you to commit changes. Use conventional commits format: type(scope): description",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "The commit message. Must accurately describe what you changed in edit mode, using conventional commits format (e.g., 'fix(desktop): resolve TypeScript errors in approval handlers')"
          ),
      }),
      execute: async ({ message }, { abortSignal }) => {
        // Add all files
        const addPid = (await doToolExecute(
          compute.tools.execute_bash.execute!,
          { command: "git add -A", working_directory: REPO_ROOT, env: {} },
          { abortSignal }
        )) as any;
        await doToolExecute(
          compute.tools.process_wait.execute!,
          { pid: addPid.pid },
          { abortSignal }
        );

        // Get git diff for commit message generation
        const pid = (await doToolExecute(
          compute.tools.execute_bash.execute!,
          {
            command: "git diff --cached",
            working_directory: REPO_ROOT,
            env: {},
          },
          { abortSignal }
        )) as any;
        const diffResult = (await doToolExecute(
          compute.tools.process_wait.execute!,
          { pid: pid.pid },
          { abortSignal }
        )) as any;

        const diff = diffResult.plainOutput.lines.join("\n");

        if (!diff.trim()) {
          return { success: false, output: "No changes to commit" };
        }

        // Write commit message to temp file to preserve newlines
        const { writeFile, unlink } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const tmpFile = join(tmpdir(), `blink-commit-${Date.now()}.txt`);

        try {
          await writeFile(tmpFile, message, "utf-8");

          // Create the commit using -F to read message from file
          const commitPid = (await doToolExecute(
            compute.tools.execute_bash.execute!,
            {
              command: `git commit -F ${JSON.stringify(tmpFile)}`,
              working_directory: REPO_ROOT,
              env: {},
            },
            { abortSignal }
          )) as any;
          const commitResult = (await doToolExecute(
            compute.tools.process_wait.execute!,
            { pid: commitPid.pid },
            { abortSignal }
          )) as any;

          // Clean up temp file
          await unlink(tmpFile).catch(() => {});

          if (commitResult.exitCode !== 0) {
            return {
              success: false,
              output: commitResult.plainOutput.lines.join("\n"),
            };
          }
          return { success: true, output: `Committed: ${message}` };
        } catch (error) {
          // Clean up temp file on error
          await unlink(tmpFile).catch(() => {});
          throw error;
        }
      },
    }),
  };

  const options = blink.lastUIOptions(messages);
  let model = "anthropic/claude-sonnet-4.5";
  if (options?.model === "gpt-5") {
    model = "openai/gpt-5";
  }

  return streamText({
    model: blink.model(model),
    providerOptions: {
      openai: {
        reasoningSummary: "detailed",
      },
    },
    system: `You are an expert coding assistant for the Blink monorepo.

Blink is a framework for building AI agents as Node.js HTTP servers.

The repo root is: ${REPO_ROOT}.
The cwd is: ${process.cwd()}.

**Packages:**
- packages/blink/: Core agent runtime, CLI, dev mode, chat/storage APIs
- packages/sdk/: compute, github, slackbot, web-search, model-intent
- packages/desktop/: Electron desktop app for dev TUI with GUI
- Uses Bun, TypeScript strict mode

**Your role:**
- Read/edit files, execute bash (use bun), run tests/builds
- Follow existing patterns: AI SDK v5, async/await, Zod validation
- Be concise - no fluff, get to the point

**Testing:**
- ALWAYS use existing test files (*.test.ts) - NEVER create temporary test scripts
- Look for existing test infrastructure first (e.g., src/local/run-agent.test.ts)
- Add test cases to existing test files, don't create standalone test files
- Use bun test to run the test suite
- If you need to test something, add it to the appropriate existing test file

**Important rules:**
- NEVER use git_commit or commit changes unless the user explicitly asks you to commit
- When making changes, just report what you did - don't commit
- Let the user decide when to commit
- NEVER create markdown files, READMEs, documentation files, or example scripts
- NEVER write markdown summaries or documentation unless explicitly asked
- Focus on making code changes, not writing about them
- NEVER create or modify git hooks (pre-commit, pre-push, etc.) in .git/hooks/
- NEVER touch anything in the .git directory

**Before committing:**
- ALWAYS run run_format, run_tests, and run_typecheck before git_commit
- If any of these fail, do NOT commit and report the failures to the user
- Only proceed with git_commit after all three checks pass

**Electron/Desktop Development:**
- When using nodeIntegration in Electron, dynamic imports resolve from process.cwd()
- NEVER bundle native dependencies (esbuild, node-pty, etc.) - always mark as external
- User agent directories should provide their own dependencies
- Use process.chdir() to set working directory for proper module resolution
- Desktop app bundles blink/react but relies on user's environment for build tools`,
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    abortSignal,
    maxOutputTokens: 64_000,
    tools,
  });
});

agent.on("ui", () => ({
  model: {
    type: "select",
    label: "Model",
    defaultValue: "sonnet",
    values: [
      { label: "Claude Sonnet 4.5", id: "sonnet" },
      { label: "GPT-5", id: "gpt-5" },
    ],
  },
}));

agent.serve();

const doToolExecute = async <INPUT, OUTPUT>(
  func: ToolExecuteFunction<INPUT, OUTPUT>,
  input: INPUT,
  { abortSignal }: { abortSignal?: AbortSignal }
) => {
  const resp = executeTool({
    execute: func,
    input,
    options: { abortSignal, toolCallId: "tool-call-id", messages: [] },
  });
  for await (const chunk of resp) {
    if (chunk.type === "final") {
      return chunk.output;
    }
  }
  throw new Error("Tool execute did not return a final chunk");
};
