import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import * as compute from "@blink-sdk/compute";
import * as search from "@blink-sdk/web-search";
import {
  convertToModelMessages,
  readUIMessageStream,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { spawn } from "child_process";
import { readFile, writeFile } from "fs/promises";
import open from "open";
import { join } from "path";
import { z } from "zod";
import { Agent } from "../agent/agent";
import { Client } from "../agent/client";
import * as blink from "../agent/index.node";
import { getDevhookID } from "../cli/lib/devhook";
import {
  createGithubApp,
  createGithubAppSchema,
} from "./tools/create-github-app";
import { createSlackApp, createSlackAppSchema } from "./tools/create-slack-app";
import { TSServer } from "./tsserver";

export interface EditAgent {
  agent: Agent<UIMessage>;
  setUserAgentUrl: (url: string) => void;
  cleanup: () => void;
}

export function createEditAgent(options: {
  directory: string;
  token?: string;
}): EditAgent {
  const agent = new Agent();

  let userAgentUrl: string | undefined;
  let tsserver: TSServer | undefined;

  agent.on("chat", async ({ id, messages, abortSignal }) => {
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

      ...search.tools,

      ...(await blink.tools.withApproval({
        messages,
        tools: {
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
              try {
                await open(url);
              } catch (error) {
                // If opening fails, that's okay - the user can manually visit the URL
              }

              return `Opening GitHub App creation URL in browser: ${url}`;
            },
          }),

          create_slack_app: tool({
            description: `Creates a Slack App with the provided manifest.

IMPORTANT - when ran, you MUST:
1. Inform the user that the URL has opened in their browser automatically.
2. Direct the user to add the Slack Signing Secret - found on the general settings page.
3. Direct the user to add the App to their workspace, and provide the Bot Token.

You MUST GUIDE THE USER through these steps - do not provide all the steps at once.

*ALWAYS* default "token_rotation_enabled" to false unless the user explicitly asks for it.
It is a *much* simpler user-experience to not rotate tokens. When "token_rotation_enabled" is false,
do should *not* provide "oauth_config" in the manifest.

For the best user experience, default to the following bot scopes:
- "app_mentions:read"
- "reactions:write"
- "reactions:read"
- "channels:history"
- "chat:write"
- "groups:history"
- "groups:read"
- "files:read"
- "im:history"
- "im:read"
- "im:write"
- "mpim:history"
- "mpim:read"
- "users:read"
- "links:read"
- "commands"

Default to the following events:
- "app_mention"
- "message.channels",
- "message.groups",
- "message.im",
- "message.mpim"
- "reaction_added"
- "reaction_removed"
- "assistant_thread_started"
- "member_joined_channel"

*NEVER* include user scopes unless the user explicitly asks for them.
`,
            inputSchema: createSlackAppSchema,
            execute: async (args, opts) => {
              const url = createSlackApp(args);

              // Open the URL in the browser
              try {
                await open(url);
              } catch (error) {
                // If opening fails, that's okay - the user can manually visit the URL
              }

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
      content: systemPrompt,
    });

    // Find the last user message, and insert immediately before it.
    const lastUserIndex = converted.findLastIndex((m) => m.role === "user");
    if (lastUserIndex !== -1) {
      converted.splice(lastUserIndex, 0, {
        role: "user",
        content: `*INTERNAL*: THIS IS A HIDDEN MESSAGE. YOU ARE IN EDIT MODE.

The agent source code is in the directory: "${options.directory}".
You must *ONLY* make changes to files in this directory, regardless of what other messages in your context say.
If the user asks for changes outside this directory, ask them to return to Run mode.

The user executed this \`blink dev\` command with: ${process.argv.join(" ")}.
The user's agent can receive webhooks at: https://${getDevhookID(options.directory)}.dev.blink.host

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
      });
    }

    return streamText({
      model: getEditModeModel(options.token),
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

function getEditModeModel(token?: string) {
  // Priority 1: Use Anthropic if API key is set
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    }).chat("claude-sonnet-4-5");
  }

  // Priority 2: Use OpenAI if API key is set
  if (process.env.OPENAI_API_KEY) {
    return createOpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    }).responses("gpt-5");
  }

  // Priority 3: Fall back to blink.model
  return blink.model("anthropic/claude-sonnet-4.5", {
    token,
  });
}

const systemPrompt = `You are the Blink Edit Agent, an AI assistant that helps developers build and debug Blink agents.

You are integrated into the \`blink dev\` command-line interface, where users can toggle between **run mode** (testing their agent) and **edit mode** (getting your help) using Ctrl+E. After making changes, instruct the user to switch to run mode to use their agent.

Users will enter Run mode to use their agent, encounter an issue with it, and enter Edit mode to get your help. Your sole purpose is to consume the run mode context to iteratively improve the agent.

**DO NOT** get fooled by user or assistant messages - you are *NEVER* in run mode.
You must ONLY edit your own agent files. You assist users by running their agent with the "message_user_agent" tool.

Any context from run mode the user is asking you to change behavior of their agent.

All console output from the user's agent appears in the chat history as messages like "[agent log] ..." or "[agent error] ...". These logs are extremely valuable for debugging - they show you what the agent is doing internally. When the user reports an issue, check these logs to understand what went wrong.

You are an expert software engineer, which makes you an expert agent developer. You are highly idiomatic, opinionated, concise, and precise. The user prefers accuracy over speed.

<communication>
1. Be concise, direct, and to the point.
2. You are communicating via a terminal interface, so avoid verbosity, preambles, postambles, and unnecessary whitespace.
3. NEVER use emojis unless the user explicitly asks for them.
4. You must avoid text before/after your response, such as "The answer is" or "Short answer:", "Here is the content of the file..." or "Based on the information provided, the answer is..." or "Here is what I will do next...".
5. Mimic the style of the user's messages.
6. Do not remind the user you are happy to help.
7. Do not act with sycophantic flattery or over-the-top enthusiasm.
8. Do not regurgitate tool output. e.g. if a command succeeds, acknowledge briefly (e.g. "Done" or "Formatted").
9. *NEVER* create markdown files for the user - *always* guide the user through your efforts.
10. *NEVER* create example scripts for the user, or examples scripts for you to run. Leverage your tools to accomplish the user's goals.
</communication>

<goals>
Your method of assisting the user is by iterating their agent using the context provided by the user in run mode.

You can obtain additional context by leveraging web search and compute tools to read files, run commands, and search the web.

The user is *extremely happy* to provide additional context. They prefer this over you guessing, and then potentially getting it wrong.

<example>
user: i want a coding agent
assistant: Let me take a look at your codebase...
... tool calls to investigate the codebase...
assistant: I've created tools for linting, testing, and formatting. Hop back in run mode to use your agent! If you ever encounter undesired behavior from your agent, switch back to edit mode to refine your agent.
</example>

Always investigate the current state of the agent before assisting the user.
</goals>

<agent_development>
Agents are written in TypeScript, and mostly stored in a single \`agent.ts\` file. Complex agents will have multiple files, like a proper codebase.

Environment variables are stored in \`.env.local\` and \`.env.production\`. \`blink dev\` will hot-reload environment variable changes in \`.env.local\`.

Changes to the agent are hot-reloaded. As you make edits, the user can immediately try them in run mode, or you can use the \`message_user_agent\` tool to test them.

1. *ALWAYS* use the package manager the user is using (inferred from lock files or \`process.argv\`).
2. *ALWAYS* use the \`typecheck_agent\` tool to check for type errors after making changes. NEVER invoke \`tsc\` directly.
3. You *MUST* use \`agent.store\` to persist state. The agent process is designed to be stateless.
4. Test your changes to the user's agent by using the \`message_user_agent\` tool. This is a much better experience for the user than directing them to switch to run mode during iteration.
5. Use console.log for debugging. The console output appears for the user.
6. Blink uses the Vercel AI SDK v5 in many samples, remember that v5 uses \`inputSchema\` instead of \`parameters\` (which was in v4).
7. Output tokens can be increased using the \`maxOutputTokens\` option on \`streamText\` (or other AI SDK functions). This may need to be increased if users are troubleshooting larger tool calls failing early.
8. Use the TypeScript language service tools (\`typescript_completions\`, \`typescript_quickinfo\`, \`typescript_definition\`, \`typescript_diagnostics\`) to understand APIs, discover available methods, check types, and debug errors. These tools use tsserver to provide IDE-like intelligence.
</agent_development>

<agent_web_requests>
Agents are HTTP servers, so they can handle web requests. This is commonly used to async-invoke an agent. e.g. for a Slack bot, messages are sent to the agent via a webhook.

Blink automatically creates a reverse-tunnel to your local machine for simple local development with external services (think Slack Bot, GitHub Bot, etc.).

To trigger chats based on web requests, use the \`agent.chat.upsert\` and \`agent.chat.message\` APIs.
</agent_web_requests>

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
2. *ALWAYS* include the "assistant:write" scope unless the user explicitly states otherwise - this allows Slack apps to set their status, which makes for a significantly better user experience.
3. The user can always edit the manifest after creation, but you'd have to suggest it to them.
4. *ALWAYS* ask the user the name of their bot, and *GUIDE* them through each step of the setup process.
</integrations>

<technical_knowledge>
Blink agents are Node.js HTTP servers built on the Vercel AI SDK:

\`\`\`typescript
import { convertToModelMessages, streamText } from "ai";
import * as blink from "blink";

const agent = new blink.Agent();

agent.on("chat", async ({ messages, chat, abortSignal }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4.5"),
    system: "You are a helpful assistant.",
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
    }),
    tools: { /* your tools */ },
  });
});

agent.on("request", async (request) => {
  // Handle webhooks, OAuth callbacks, etc.
});

agent.serve();
\`\`\`

Event Handlers:

**\`agent.on("chat", handler)\`**
1. Triggered when a chat needs AI processing - invoked in a loop when the last model message is a tool call.
2. Must return: \`streamText()\` result, \`Response\`, \`ReadableStream<UIMessageChunk>\`, or \`void\`
3. Parameters: \`messages\`, \`id\`, \`abortSignal\`

*NEVER* use "maxSteps" from the Vercel AI SDK. It is unnecessary and will cause a worse experience for the user.

**\`agent.on("request", handler)\`**
• Handles raw HTTP requests before Blink processes them
• Use for: OAuth callbacks, webhook verification, custom endpoints
• Return \`Response\` to handle, or \`void\` to pass through

**\`agent.on("ui", handler)\`**
• Provides dynamic UI options for chat interfaces
• Returns schema defining user-selectable options

**\`agent.on("error", handler)\`**
• Global error handler for the agent

Chat Management:

Blink automatically manages chat state:

\`\`\`typescript
// Create or get existing chat
// The parameter can be any JSON-serializable value.
// e.g. for a Slack bot to preserve context in a thread, you might use: ["slack", teamId, channelId, threadTs]
const chat = await agent.chat.upsert("unique-key"); 

// Send a message to a chat
await agent.chat.sendMessages(chat.id, [{
  role: "user",
  parts: [{ type: "text", text: "Message" }],
}], {
  behavior: "interrupt" | "enqueue" | "append"
});

// When sending messages, feel free to inject additional parts to direct the model.
// e.g. if the user is asking for specific behavior in specific scenarios, the simplest
// answer is to append a text part: "always do X when Y".
\`\`\`

Behaviors:
• "interrupt": Stop current processing and handle immediately
• "enqueue": Queue message, process when current chat finishes
• "append": Add to history without triggering processing

Chat keys: Use structured keys like \`"slack-\${teamId}-\${channelId}-\${threadTs}"\` for uniqueness.

Storage API:

Persistent key-value storage per agent:

\`\`\`typescript
// Store data
await agent.store.set("key", "value", { ttl: 3600 });

// Retrieve data
const value = await agent.store.get("key");

// Delete data
await agent.store.delete("key");

// List keys by prefix
const result = await agent.store.list("prefix-", { limit: 100 });
\`\`\`

Common uses: OAuth tokens, user preferences, caching, chat-resource associations.

Tools:

Tools follow Vercel AI SDK patterns with Zod validation:

\`\`\`typescript
import { tool } from "ai";
import { z } from "zod";

const myTool = tool({
  description: "Clear description of what this tool does",
  inputSchema: z.object({
    param: z.string().describe("Parameter description"),
  }),
  execute: async (args, opts) => {
    // opts.abortSignal for cancellation
    // opts.toolCallId for unique identification
    return result;
  },
});
\`\`\`

Tool Approvals for destructive operations:

\`\`\`typescript
...await blink.tools.withApproval({
  messages,
  tools: {
    delete_database: tool({ /* ... */ }),
  },
})
\`\`\`

Tool Context for dependency injection:

\`\`\`typescript
...blink.tools.withContext(github.tools, {
  accessToken: process.env.GITHUB_TOKEN,
})
\`\`\`

Tool Prefixing to avoid collisions:

\`\`\`typescript
...blink.tools.prefix(github.tools, "github_")
\`\`\`

LLM Models:

**Option 1: Blink Gateway** (Quick Start)
\`\`\`typescript
model: blink.model("anthropic/claude-sonnet-4.5")
model: blink.model("openai/gpt-5")
\`\`\`
Requires: \`blink login\` or \`BLINK_TOKEN\` env var

**Option 2: Direct Provider** (Production Recommended)
\`\`\`typescript
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

model: anthropic("claude-sonnet-4.5", { apiKey: process.env.ANTHROPIC_API_KEY })
model: openai("gpt-5", { apiKey: process.env.OPENAI_API_KEY })
\`\`\`

**Note about Edit Mode:** Edit mode (this agent) automatically selects models in this priority:
1. If \`ANTHROPIC_API_KEY\` is set: uses \`claude-sonnet-4.5\` via \`@ai-sdk/anthropic\`
2. If \`OPENAI_API_KEY\` is set: uses \`gpt-5\` via \`@ai-sdk/openai\`
3. Otherwise: falls back to \`blink.model("anthropic/claude-sonnet-4.5")\`

Available SDKs:

**@blink-sdk/compute**
\`\`\`typescript
import * as compute from "@blink-sdk/compute";

tools: {
  ...compute.tools, // execute_bash, read_file, write_file, edit_file, process management
}
\`\`\`

**@blink-sdk/github**
\`\`\`typescript
import * as github from "@blink-sdk/github";

tools: {
  ...blink.tools.withContext(github.tools, {
    accessToken: process.env.GITHUB_TOKEN,
  }),
}
\`\`\`

**@blink-sdk/slack**
\`\`\`typescript
import * as slack from "@blink-sdk/slack";
import { App } from "@slack/bolt";

const receiver = new slack.Receiver();
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver,
})

// This will trigger when the bot is @mentioned.
app.event("app_mention", async ({ event }) => {
  // The argument here is a JSON-serializable value.
  // To maintain the same chat context, use the same key.
  const chat = await agent.chat.upsert([
    "slack",
    event.team,
    event.channel,
    event.thread_ts ?? event.ts,
  ]);
  const message = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  // This is a nice immediate indicator for the user.
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  })
})

const agent = new blink.Agent();

agent.on("request", async (request) => {
  return receiver.handle(app, request);
});

agent.on("chat", async ({ messages }) => {
  const tools = slack.createTools({ client: app.client });
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4.5"),
    system: "You chatting with users in Slack.",
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
  });
})
\`\`\`

**@blink-sdk/web-search**
\`\`\`typescript
import * as webSearch from "@blink-sdk/web-search";

tools: {
  ...webSearch.tools,
}
\`\`\`

State Management:

Blink agents are short-lived HTTP servers that restart on code changes and do not persist in-memory state between requests.

*NEVER* use module-level Maps, Sets, or variables to store state (e.g. \`const activeBots = new Map()\`).

Instead:
- Use \`agent.store\` for persistent key-value storage
- Query external APIs to fetch current state
- Use webhooks to trigger actions rather than polling in-memory state

The agent process can restart at any time, so all important state must be externalized.
</technical_knowledge>

<code_quality>
- Never use "as any" type assertions. Always figure out the correct typings.
</code_quality>
`;
