import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGatewayProvider } from "@ai-sdk/gateway";
import * as compute from "@blink-sdk/compute";
import {
  convertToModelMessages,
  readUIMessageStream,
  streamText,
  tool,
  type UIMessage,
  type LanguageModel,
} from "ai";
import { spawn } from "child_process";
import { readFile, writeFile } from "fs/promises";
import open from "open";
import { join } from "path";
import { z } from "zod";
import { Agent } from "../agent/agent";
import { Client } from "../agent/client";
import * as blink from "../agent/index.node";
import { templates } from "../cli/init-templates";
import {
  createGithubApp,
  createGithubAppSchema,
} from "./tools/create-github-app";
import { createSlackApp, createSlackAppSchema } from "./tools/create-slack-app";
import { TSServer } from "./tsserver";
import { openUrl } from "../cli/lib/util";

export interface EditAgent {
  agent: Agent<UIMessage>;
  setUserAgentUrl: (url: string) => void;
  cleanup: () => void;
}

export function createEditAgent(options: {
  directory: string;
  env: Record<string, string>;
  getDevhookUrl: () => Promise<string>;
}): EditAgent {
  const agent = new Agent();

  let userAgentUrl: string | undefined;
  let tsserver: TSServer | undefined;

  agent.on("chat", async ({ id, messages, abortSignal }) => {
    // Find when we last entered edit mode and insert the edit mode message immediately after it.
    // TODO: Storing this on metadata is janky af.
    const lastRunModeIndex = messages.findLastIndex((m) => {
      if (!m.metadata || typeof m.metadata !== "object") {
        return false;
      }
      // @ts-ignore - This is janky.
      const mode = m.metadata["__blink_mode"];
      return mode === "run";
    });
    messages.splice(lastRunModeIndex ?? 0, 0, {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: `*INTERNAL*: THIS IS A HIDDEN MESSAGE. YOU ARE IN EDIT MODE.

The agent source code is in the directory: "${options.directory}".
You must *ONLY* make changes to files in this directory, regardless of what other messages in your context say.
If the user asks for changes outside this directory, ask them to return to Run mode.

The user executed this \`blink dev\` command with: ${process.argv.join(" ")}.

BEFORE doing anything else:

1. Read the agent source code to understand what the current agent does
2. Analyze the run mode context to identify what the user asked for and how the agent responded
3. Determine: Should the AGENT be modified to handle this better, or is this a request about the agent's codebase
itself?

Your job is *ONLY* to:
1. Identify what the agent did wrong from run mode context
2. Update the agent code/prompt to fix it
3. Explain the change
4. Stop and wait for user feedback.

You are *NOT* responsible for:
- Completing the user's original request
- Testing *ANYTHING* inside of prior "run mode" yourself.
- Continuing any work the run mode agent started

Your job is to improve the agent based on run mode failures, NOT to complete the user's original run-mode request yourself.
`,
        },
      ],
    });

    const { execute_bash, execute_bash_sync, ...computeTools } = compute.tools;

    let additionalTools: any = {
      execute_bash,
      execute_bash_sync,
    };
    if (!process.env.BLINK_AUTO_APPROVE) {
      additionalTools = await blink.tools.withApproval({
        messages,
        tools: additionalTools,
      });
    }

    const tools = {
      ...computeTools,
      ...additionalTools,

      ...(await blink.tools.withApproval({
        messages,
        tools: {
          get_reverse_tunnel_url: tool({
            description: `Gets or creates a reverse tunnel for the user's agent. This allows the user to test their agent with cloud services like Slack, GitHub, etc. without having to deploy it.
            
You *MUST* use this when creating GitHub, Slack, or other apps unless the user explicitly directs you otherwise.`,
            inputSchema: z.object({}),
            execute: async () => {
              return options.getDevhookUrl();
            },
          }),

          create_github_app: tool({
            description: `Creates a GitHub App using GitHub's app manifest flow.

IMPORTANT: You must explain to the user what's happening and why:
- Tell them this will open a localhost URL that redirects them to GitHub
- Explain that the localhost redirect is used to securely capture the app credentials after creation
- Mention that they'll be taken to GitHub to create the app, and when they complete it, the credentials will be automatically saved to their environment file
- This uses GitHub's app manifest flow: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest

You *must* ensure the organization is correct - ask the user prior.

Once they complete the app creation, environment variables will be automatically set in the provided environment file.

After approval, the URL will be opened automatically in their browser.`,
            inputSchema: z.object({
              manifest: createGithubAppSchema,
              envFile: z
                .enum(["local", "production"])
                .describe(
                  "The environment file to put credentials in on app creation."
                ),
              organization: z
                .string()
                .optional()
                .describe(
                  "An optional GitHub organization the app should be created for. Leave blank to create a personal app."
                ),
            }),
            execute: async (args, opts) => {
              const url = await createGithubApp(
                args.manifest,
                args.organization,
                async (err, data) => {
                  if (err) {
                    await agent.chat.sendMessages(id, [
                      {
                        role: "assistant",
                        parts: [
                          {
                            type: "text",
                            text: `Failed to create GitHub App: ${err.message}`,
                          },
                        ],
                      },
                    ]);
                    return;
                  }
                  if (!data) {
                    // Data always exists if there's no error.
                    return;
                  }

                  // Store credentials in the appropriate env file
                  try {
                    const envFileName =
                      args.envFile === "production"
                        ? ".env.production"
                        : ".env.local";
                    const envFilePath = join(options.directory, envFileName);

                    // Read existing env file
                    let existingContent = "";
                    try {
                      existingContent = await readFile(envFilePath, "utf-8");
                    } catch (err) {
                      // File doesn't exist, that's okay
                    }

                    // Append GitHub App credentials
                    const credentials = `
# GitHub App credentials (created with the blink edit agent)
GITHUB_APP_ID=${data.id}
GITHUB_CLIENT_ID=${data.client_id}
GITHUB_CLIENT_SECRET=${data.client_secret}
GITHUB_WEBHOOK_SECRET=${data.webhook_secret}
GITHUB_PRIVATE_KEY="${btoa(data.pem)}"
`;

                    await writeFile(
                      envFilePath,
                      existingContent + credentials,
                      "utf-8"
                    );
                  } catch (writeErr) {
                    await agent.chat.sendMessages(id, [
                      {
                        role: "assistant",
                        parts: [
                          {
                            type: "text",
                            text: `GitHub App created but failed to write credentials to env file: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
                          },
                        ],
                      },
                    ]);
                    return;
                  }

                  await agent.chat.sendMessages(id, [
                    {
                      role: "assistant",
                      parts: [
                        {
                          type: "text",
                          text: `GitHub App created successfully. The following environment variables have been set in the ${args.envFile} environment file: GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET, GITHUB_PRIVATE_KEY.`,
                        },
                      ],
                    },
                  ]);
                }
              );

              // Open the URL in the browser
              const opened = await openUrl(url);

              return `Opening GitHub App creation URL in browser: ${url}`;
            },
          }),

          create_slack_app: tool({
            description: `Creates a Slack App with the provided manifest.

IMPORTANT - when ran, you MUST:
1. Inform the user that the URL has opened in their browser automatically to *Slack*.
2. Direct the user to add the Slack Signing Secret - found on the general settings page.
3. Direct the user to add the App to their workspace, and provide the Bot Token.

You MUST GUIDE THE USER through these steps - do not provide all the steps at once.
`,
            inputSchema: createSlackAppSchema,
            execute: async (args, opts) => {
              const url = createSlackApp(args);

              // Open the URL in the browser
              await openUrl(url);

              return `Opened Slack App creation URL in browser: ${url}`;
            },
          }),
        },
      })),

      message_user_agent: tool({
        description: `Messages the user agent. There is no conversation history - this will be the only message sent, and only one message responds. Every time you invoke this tool, a new conversation occurs.
        
Instruct the agent to invoke tools you are debugging. e.g. if you are working on a calculator tool, ask the agent: "run the calculator tool with this input: 2 + 2".`,
        inputSchema: z.object({
          message: z.string(),
        }),
        execute: async (args, opts) => {
          if (!userAgentUrl) {
            return "User agent URL is not available. Cannot test user agent.";
          }

          // Create a client to the user's agent
          const client = new Client({
            baseUrl: userAgentUrl,
          });

          // Send the message directly to the user's agent
          const stream = await client.chat(
            {
              id: crypto.randomUUID(),
              messages: [
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  parts: [
                    {
                      type: "text",
                      text: args.message,
                    },
                  ],
                },
              ],
            },
            {
              signal: opts.abortSignal,
            }
          );

          const messageStream = readUIMessageStream({
            stream,
          });

          let lastMessage: UIMessage | undefined;
          for await (const message of messageStream) {
            lastMessage = message;
          }

          return lastMessage;
        },
      }),

      typecheck_agent: tool({
        description: `*ONLY* typecheck the agent being worked on. Reports all syntax errors.

Do *NOT* confuse this with tools in run mode for typechecking.`,
        inputSchema: z.object({}),
        execute: async () => {
          const spawned = spawn(
            "node",
            [join(options.directory, "node_modules/.bin/tsc"), "--noEmit"],
            {
              stdio: "pipe",
              cwd: options.directory,
            }
          );
          let stdout = "";
          let stderr = "";
          let exitCode: number | undefined;
          spawned.stdout.on("data", (data) => {
            stdout += Buffer.from(data).toString("utf-8");
          });
          spawned.stderr.on("data", (data) => {
            stderr += Buffer.from(data).toString("utf-8");
          });
          await new Promise<void>((resolve) => {
            spawned.on("close", (code) => {
              exitCode = code ?? undefined;
              resolve();
            });
          });
          return {
            stdout,
            stderr,
            exitCode,
          };
        },
      }),

      // Eventually, we'll add these back in. They don't work well right now.
      //       typescript_completions: tool({
      //         description: `Get TypeScript completions at a specific location in a file. This uses tsserver to get intelligent completions based on the TypeScript language service.

      // Line and column are 1-based (first line is 1, first character is 1).

      // This is extremely useful when you need to:
      // - Discover what properties/methods are available on an object
      // - See what imports are available
      // - Get parameter suggestions for function calls
      // - Understand the API surface of a type`,
      //         inputSchema: z.object({
      //           file: z
      //             .string()
      //             .describe(
      //               "Path to the TypeScript file relative to the agent directory"
      //             ),
      //           line: z.number().describe("Line number (1-based)"),
      //           column: z.number().describe("Column/offset number (1-based)"),
      //           prefix: z
      //             .string()
      //             .optional()
      //             .describe("Optional prefix to filter completions"),
      //         }),
      //         execute: async ({ file, line, column, prefix }) => {
      //           if (!tsserver) {
      //             tsserver = new TSServer(options.directory);
      //           }

      //           try {
      //             // Open the file if not already open
      //             await tsserver.openFile(file);

      //             // Get completions
      //             const completions = await tsserver.getCompletions(
      //               file,
      //               line,
      //               column,
      //               prefix
      //             );

      //             if (!completions || !completions.entries) {
      //               return "No completions available at this location.";
      //             }

      //             // Format the completions nicely
      //             const entries = completions.entries
      //               .slice(0, 50) // Limit to 50 to avoid overwhelming output
      //               .map((entry: any) => {
      //                 let result = `- ${entry.name}`;
      //                 if (entry.kind) {
      //                   result += ` (${entry.kind})`;
      //                 }
      //                 if (entry.kindModifiers) {
      //                   result += ` [${entry.kindModifiers}]`;
      //                 }
      //                 return result;
      //               })
      //               .join("\n");

      //             return `Completions at ${file}:${line}:${column}:\n\n${entries}`;
      //           } catch (err) {
      //             return `Error getting completions: ${err instanceof Error ? err.message : String(err)}`;
      //           }
      //         },
      //       }),

      //       typescript_quickinfo: tool({
      //         description: `Get quick info (hover information) for a symbol at a specific location. This shows you the type information, documentation, and signature of the symbol.

      // Line and column are 1-based.

      // Use this to:
      // - Understand what type a variable has
      // - See function signatures
      // - Read JSDoc documentation
      // - Understand imported types`,
      //         inputSchema: z.object({
      //           file: z
      //             .string()
      //             .describe(
      //               "Path to the TypeScript file relative to the agent directory"
      //             ),
      //           line: z.number().describe("Line number (1-based)"),
      //           column: z.number().describe("Column/offset number (1-based)"),
      //         }),
      //         execute: async ({ file, line, column }) => {
      //           if (!tsserver) {
      //             tsserver = new TSServer(options.directory);
      //           }

      //           try {
      //             await tsserver.openFile(file);
      //             const info = await tsserver.getQuickInfo(file, line, column);

      //             if (!info) {
      //               return "No information available at this location.";
      //             }

      //             let result = "";
      //             if (info.displayString) {
      //               result += `Type: ${info.displayString}\n`;
      //             }
      //             if (info.documentation) {
      //               result += `\nDocumentation: ${info.documentation}\n`;
      //             }
      //             if (info.tags) {
      //               result += `\nTags: ${JSON.stringify(info.tags)}\n`;
      //             }

      //             return result || "No detailed information available.";
      //           } catch (err) {
      //             return `Error getting quick info: ${err instanceof Error ? err.message : String(err)}`;
      //           }
      //         },
      //       }),

      //       typescript_definition: tool({
      //         description: `Get the definition location of a symbol. This is like "Go to Definition" in an IDE.

      // Line and column are 1-based.

      // Use this to:
      // - Find where a function is defined
      // - Locate type definitions
      // - Navigate to imported symbols`,
      //         inputSchema: z.object({
      //           file: z
      //             .string()
      //             .describe(
      //               "Path to the TypeScript file relative to the agent directory"
      //             ),
      //           line: z.number().describe("Line number (1-based)"),
      //           column: z.number().describe("Column/offset number (1-based)"),
      //         }),
      //         execute: async ({ file, line, column }) => {
      //           if (!tsserver) {
      //             tsserver = new TSServer(options.directory);
      //           }

      //           try {
      //             await tsserver.openFile(file);
      //             const definitions = await tsserver.getDefinition(file, line, column);

      //             if (!definitions || definitions.length === 0) {
      //               return "No definition found.";
      //             }

      //             const results = definitions.map((def: any) => {
      //               const relPath = relative(options.directory, def.file);
      //               return `${relPath}:${def.start.line}:${def.start.offset}`;
      //             });

      //             return `Definition(s):\n${results.join("\n")}`;
      //           } catch (err) {
      //             return `Error getting definition: ${err instanceof Error ? err.message : String(err)}`;
      //           }
      //         },
      //       }),

      //       typescript_diagnostics: tool({
      //         description: `Get TypeScript diagnostics (errors) for a file. This gives you both syntax and semantic errors.

      // Use this instead of typecheck_agent when you want to check a specific file rather than the whole project.`,
      //         inputSchema: z.object({
      //           file: z
      //             .string()
      //             .describe(
      //               "Path to the TypeScript file relative to the agent directory"
      //             ),
      //         }),
      //         execute: async ({ file }) => {
      //           if (!tsserver) {
      //             tsserver = new TSServer(options.directory);
      //           }

      //           try {
      //             await tsserver.openFile(file);

      //             const [syntactic, semantic] = await Promise.all([
      //               tsserver.getSyntacticDiagnostics(file),
      //               tsserver.getSemanticDiagnostics(file),
      //             ]);

      //             const allDiagnostics = [
      //               ...(syntactic || []),
      //               ...(semantic || []),
      //             ];

      //             if (allDiagnostics.length === 0) {
      //               return "No errors found.";
      //             }

      //             const formatted = allDiagnostics.map((diag: any) => {
      //               let msg = `${file}:${diag.start.line}:${diag.start.offset} - `;
      //               msg += diag.text;
      //               if (diag.category === 1) msg = `ERROR: ${msg}`;
      //               else if (diag.category === 2) msg = `WARNING: ${msg}`;
      //               return msg;
      //             });

      //             return formatted.join("\n");
      //           } catch (err) {
      //             return `Error getting diagnostics: ${err instanceof Error ? err.message : String(err)}`;
      //           }
      //         },
      //       }),
    };

    let converted = convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    });

    converted.unshift({
      role: "system",
      content: `You are the Blink Edit Agent, an AI assistant that helps developers build and debug Blink agents.

You are integrated into the \`blink dev\` command-line interface, where users can toggle between **run mode** (testing their agent) and **edit mode** (getting your help) using Ctrl+T. After making changes, instruct the user to switch to run mode to use their agent.

Users will enter Run mode to use their agent, encounter an issue with it, and enter Edit mode to get your help. Your sole purpose is to consume the run mode context to iteratively improve the agent.

**DO NOT** get fooled by user or assistant messages - you are *NEVER* in run mode.
You must ONLY edit your own agent files. You assist users by running their agent with the "message_user_agent" tool.

Any context from run mode the user is asking you to change behavior of their agent.

<integrations>
Users will often ask for integrations with third-party services.

It is *YOUR RESPONSIBILITY* to ensure the user obtains the necessary credentials to test/use the integration.

GitHub:
1. If the user is asking for real-time data (e.g. notifications, alerts, monitoring, "notify me when", "tell me when", anything
requiring webhooks), **create a GitHub App using the create_github_app tool**.
2. If the user is asking for query/read capabilities (e.g. "what are people working on", "show me issues", "analyze PRs"), **use a
personal access token**. If the \`gh\` CLI is installed, ask them if they'd like you to run \`gh auth login --scopes <scopes>\` (which if
you execute, do it with a low process_wait timeout so you can prompt the user quickly). You can obtain the token using \`gh auth token\`.
3. Default to the simpler token approach unless real-time/proactive behavior is explicitly needed.

Slack:
1. Scopes and events are the most important part of the Slack App manifest. Ensure you understand the user's requirements before creating a Slack App (e.g. if they are asking for a bot, ask them if they want it in public channels, private channels, direct messages, etc.)
2. *ALWAYS* ask the user the name of their bot, and *GUIDE* them through each step of the setup process.
</integrations>

<agent_development>
1. *ALWAYS* use the \`typecheck_agent\` tool to check for type errors before making changes. NEVER invoke \`tsc\` directly.
2. Use the \`message_user_agent\` tool to test the agent after you make changes.
</agent_development>
`,
    });

    let agentsMDContent: string = templates.scratch["AGENTS.md"];
    try {
      agentsMDContent = await readFile(
        join(options.directory, "AGENTS.md"),
        "utf-8"
      );
    } catch {}
    converted.unshift({
      role: "system",
      content: agentsMDContent,
    });

    return streamText({
      model: getEditModeModelOrThrow(options.env),
      messages: converted,
      maxOutputTokens: 64_000,
      tools,
      abortSignal,
      experimental_repairToolCall: ({ tools, toolCall }) => {
        const hasTool = Object.keys(tools).includes(toolCall.toolName);
        if (!hasTool) {
          throw new Error(
            `Invalid tool call. Tool "${toolCall.toolName}" is not available to the EDIT AGENT.`
          );
        }
        throw new Error(`You have this tool, but you used an invalid input.`);
      },
    });
  });

  return {
    agent,
    setUserAgentUrl: (url: string) => {
      userAgentUrl = url;
    },
    cleanup: () => {
      if (tsserver) {
        tsserver.close();
        tsserver = undefined;
      }
    },
  };
}

/**
 * Returns a model for edit mode, or undefined if no API key is available.
 */
export function getEditModeModel(
  env: Record<string, string>
): LanguageModel | undefined {
  // Priority 1: Use Anthropic if API key is set
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL,
    }).chat("claude-sonnet-4-5");
  }

  // Priority 2: Use OpenAI if API key is set
  if (env.OPENAI_API_KEY) {
    return createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
      // avoid the responses API due to https://github.com/coder/blink/issues/34#issuecomment-3426704264
    }).chat("gpt-5");
  }

  // Priority 3: Use AI Gateway if API key is set
  if (env.AI_GATEWAY_API_KEY) {
    return createGatewayProvider({
      apiKey: env.AI_GATEWAY_API_KEY,
    })("anthropic/claude-sonnet-4-5");
  }

  return undefined;
}

/**
 * Returns a model for edit mode, throwing if no API key is available.
 */
function getEditModeModelOrThrow(env: Record<string, string>) {
  const model = getEditModeModel(env);
  if (!model) {
    throw new Error("No API key available for edit mode");
  }
  return model;
}
