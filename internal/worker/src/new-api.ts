import type { Email, OtelSpan, TelemetryEvent } from "@blink.so/api/server";
import server from "@blink.so/api/server";
import type { AgentDeployment } from "./agent-deployment";
import type { Chat } from "./chat";
import { generateTitleFromMessages } from "./chat/generate-title-from-messages";
import { uploadToR2 } from "./chat/upload-to-r2";
import type { CommandLineAuth } from "./command-line-auth";
import connectToDatabase from "./database";
import { getAgentLogs } from "./logs/clickhouse";
import { writePlatformLog } from "./logs/client";
import { getAgentRuntimeUsage } from "./logs/runtime";
import {
  readTraces,
  writeTraces,
  type ClickHouseConfig,
  type ReadTracesOpts,
} from "./traces/clickhouse";
import type { Workspace } from "./workspace";

const agentRequestHostRegex = /^(.*)\.agent\.blink\.host$/;
const devRequestHostRegex = /^(.*)\.dev\.blink\.host$/;
const requestHostRegex = /^(.*)\.blink\.host$/;

const assertEnv = (name: string): string => {
  if (!process.env[name]) {
    throw new Error(`${name} is not set`);
  }
  return process.env[name];
};

export default function handleNewAPI(
  req: Request,
  env: Env,
  ctx: ExecutionContext
) {
  let apiBaseURL = new URL("https://blink.coder.com");
  if (env.NODE_ENV === "development") {
    apiBaseURL = new URL("http://localhost:3000");
  }

  return server.fetch(
    req,
    {
      enableSignups: true,
      enableOauth: true,
      GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,

      apiBaseURL,
      accessUrl: apiBaseURL,
      matchRequestHost: (host) => {
        // These two are for backwards compatibility.
        let exec = devRequestHostRegex.exec(host);
        if (exec) {
          return exec[1];
        }
        exec = agentRequestHostRegex.exec(host);
        if (exec) {
          return exec[1];
        }
        // This is the real one.
        exec = requestHostRegex.exec(host);
        if (exec) {
          return exec[1];
        }
        return undefined;
      },
      createRequestURL: (id) => {
        return new URL(`https://${id}.blink.host`);
      },

      agentStore: (targetID) => {
        const toKey = (key: string) => {
          return `${targetID}:${key}`;
        };
        const fromKey = (key: string) => {
          return key.split(":")[1]!;
        };

        return {
          delete: async (key) => {
            await env.AGENT_STORE.delete(toKey(key));
          },
          get: async (key) => {
            const value = await env.AGENT_STORE.get(toKey(key));
            if (!value) {
              return undefined;
            }
            return value;
          },
          set: async (key, value) => {
            await env.AGENT_STORE.put(toKey(key), value);
          },
          list: async (prefix, options) => {
            const entries = await env.AGENT_STORE.list({
              prefix: toKey(prefix ?? ""),
            });
            return {
              entries: entries.keys.map((key) => ({
                key: fromKey(key.name),
                ttl: key.expiration,
              })),
              cursor: entries.list_complete ? undefined : entries.cursor,
            };
          },
        };
      },

      auth: {
        sendTokenToWebSocket: async (id, token) => {
          const cli = env.COMMAND_LINE_AUTH.get(
            env.COMMAND_LINE_AUTH.idFromName(id)
          ) as InstanceType<typeof CommandLineAuth>;
          await cli.dispatch(token);
        },
        handleWebSocketTokenRequest: async (id, request) => {
          const cli = env.COMMAND_LINE_AUTH.get(
            env.COMMAND_LINE_AUTH.idFromName(id)
          ) as InstanceType<typeof CommandLineAuth>;
          return cli.fetch(request);
        },
      },
      database: async () => {
        return connectToDatabase(env);
      },
      async deployAgent(deployment) {
        const agentDeployment = env.AGENT_DEPLOYMENT.get(
          env.AGENT_DEPLOYMENT.idFromName(deployment.id)
        ) as InstanceType<typeof AgentDeployment>;
        await agentDeployment.deploy(deployment);
      },
      chat: {
        handleStart: async (opts) => {
          const chat = env.CHAT.get(
            env.CHAT.idFromName(opts.id)
          ) as InstanceType<typeof Chat>;
          await chat.start(opts);
        },
        handleStop: async (id) => {
          const chat = env.CHAT.get(env.CHAT.idFromName(id)) as InstanceType<
            typeof Chat
          >;
          await chat.stop();
        },
        handleStream: async (id, req) => {
          const chat = env.CHAT.get(env.CHAT.idFromName(id)) as InstanceType<
            typeof Chat
          >;
          return chat.fetch(req);
        },
        handleMessagesChanged: async (event, id, messages) => {
          const chat = env.CHAT.get(env.CHAT.idFromName(id)) as InstanceType<
            typeof Chat
          >;
          await chat.broadcastMessagesChanged(event, messages);
        },
        generateTitle: (opts) => {
          if (!env.OPENAI_API_KEY) {
            return;
          }
          ctx.waitUntil(
            generateTitleFromMessages({
              env,
              messages: opts.messages,
            })
              .then(async (title) => {
                const db = await connectToDatabase(env);
                await db.updateChatByID({
                  id: opts.id,
                  title,
                });
              })
              .catch((err) => {
                console.warn("Failed to generate title from messages", err);
              })
          );
        },
      },
      files: {
        upload: async (opts) => {
          const db = await connectToDatabase(env);
          const id = crypto.randomUUID();
          await uploadToR2(
            env.USER_FILES,
            id,
            opts.file.stream(),
            opts.file.type,
            req.signal,
            opts.file.name
          );
          await db.insertFile({
            id,
            name: opts.file.name,
            message_id: null,
            user_id: null,
            organization_id: null,
            content_type: opts.file.type,
            byte_length: opts.file.size,
            pdf_page_count: null,
            content: null,
          });
          return {
            id,
            url: `https://blink.coder.com/api/files/${id}`,
          };
        },
        download: async (id) => {
          const file = await env.USER_FILES.get(id);
          if (!file) {
            throw new Error("File not found");
          }
          return {
            stream: file.body,
            name: file.customMetadata?.name ?? "",
            size: file.size,
            type: file.httpMetadata?.contentType ?? "",
          };
        },
      },
      logs: {
        get: getAgentLogs,
        write: async (opts) => {
          await writePlatformLog(env, {
            agentId: opts.agent_id,
            event: opts.event,
          });
        },
      },
      traces: {
        write: async (spans: OtelSpan[]): Promise<void> => {
          const config: ClickHouseConfig = {
            url: assertEnv("CLICKHOUSE_HOST"),
            username: assertEnv("CLICKHOUSE_USERNAME"),
            password: assertEnv("CLICKHOUSE_PASSWORD"),
            database: assertEnv("CLICKHOUSE_DATABASE"),
          };
          return writeTraces(spans, config);
        },
        read: async (opts: ReadTracesOpts): Promise<OtelSpan[]> => {
          const config: ClickHouseConfig = {
            url: assertEnv("CLICKHOUSE_HOST"),
            username: assertEnv("CLICKHOUSE_USERNAME"),
            password: assertEnv("CLICKHOUSE_PASSWORD"),
            database: assertEnv("CLICKHOUSE_DATABASE"),
          };
          return readTraces(opts, config);
        },
      },
      runtime: {
        usage: async (opts) => {
          return getAgentRuntimeUsage(opts);
        },
      },
      devhook: {
        disableAuth: true,
        handleListen: async (id, req) => {
          const ws = env.WORKSPACE.get(
            env.WORKSPACE.idFromName(id)
          ) as DurableObjectStub<Workspace>;
          const headers = new Headers(req.headers);
          headers.set("x-blink-magic-connection", "server");
          return ws.fetch("https://do", {
            headers,
            method: req.method,
            body: req.body,
          });
        },
        handleRequest: async (id, req) => {
          const headers = new Headers(req.headers);
          headers.set("x-blink-proxy-url", req.url);
          const ws = env.WORKSPACE.get(
            env.WORKSPACE.idFromName(id)
          ) as DurableObjectStub<Workspace>;
          return ws.fetch("https://do", {
            headers,
            method: req.method,
            body: req.body,
            redirect: "manual",
          });
        },
      },
      compute: {
        handleConnect: async (id, req) => {
          const ws = env.WORKSPACE.get(
            env.WORKSPACE.idFromName(id)
          ) as DurableObjectStub<Workspace>;
          const headers = new Headers(req.headers);
          headers.set("x-blink-magic-connection", "client");
          return ws.fetch("https://do", {
            headers,
            method: req.method,
            body: req.body,
          });
        },
        handleServe: async (id, req) => {
          const ws = env.WORKSPACE.get(
            env.WORKSPACE.idFromName(id)
          ) as DurableObjectStub<Workspace>;
          const headers = new Headers(req.headers);
          headers.set("x-blink-magic-connection", "server");
          return ws.fetch("https://do", {
            headers,
            method: req.method,
            body: req.body,
          });
        },
      },
      sendEmail: process.env.KNOCK_API_KEY
        ? async (email: Email) => {
            const { getKnockService } = await import(
              "@blink.so/database/knock-service"
            );
            const knockService = getKnockService();
            if (!knockService) {
              throw new Error("Knock service not configured");
            }

            switch (email.type) {
              case "verification":
                await knockService.triggerWorkflow(
                  "validate-email",
                  [
                    {
                      id: email.email,
                      email: email.email,
                      name: email.name,
                    },
                  ],
                  { code: email.code }
                );
                break;
              case "password-reset":
                await knockService.triggerWorkflow(
                  "reset-password",
                  [
                    {
                      id: email.email,
                      email: email.email,
                      name: email.name,
                    },
                  ],
                  { code: email.code }
                );
                break;
              case "invite":
                await knockService.triggerWorkflow(
                  "new-user-invite",
                  [email.email],
                  {
                    inviter_name: email.inviterName,
                    inviter_email: email.inviterEmail,
                    team_name: email.teamName,
                    role: email.role,
                    invite_token: email.inviteUrl.split("/").pop(),
                    account_name: email.teamName,
                    invite_message: `You've been invited to join ${email.teamName} as a ${email.role}.`,
                    invite_token_url: email.inviteUrl,
                  }
                );
                break;
            }
          }
        : undefined,
      sendTelemetryEvent: process.env.KNOCK_API_KEY
        ? async (event: TelemetryEvent) => {
            const { getKnockService } = await import(
              "@blink.so/database/knock-service"
            );
            const knockService = getKnockService();
            if (!knockService) {
              throw new Error("Knock service not configured");
            }

            switch (event.type) {
              case "user.registered":
                await knockService.identifyUser({
                  id: event.userId,
                  email: event.email,
                  name: event.name,
                  properties: {
                    status: "registered",
                    ...(event.earlyAccess !== undefined && {
                      early_access: event.earlyAccess,
                    }),
                    ...(event.createdAt && { created_at: event.createdAt }),
                  },
                });
                break;
              case "user.oauth_registered":
                await knockService.identifyUser({
                  id: event.userId,
                  email: event.email,
                  name: event.name,
                  properties: {
                    status: "oauth_registered",
                    provider: event.provider,
                    ...(event.createdAt && { created_at: event.createdAt }),
                  },
                });
                break;
              case "user.invited":
                await knockService.identifyUser({
                  id: event.email, // Use email as ID for invited users
                  email: event.email,
                  name: null,
                  properties: {
                    status: "invited",
                    ...(event.role && { role: event.role }),
                    ...(event.invitedAt && { invited_at: event.invitedAt }),
                    ...(event.inviteCode && { invite_code: event.inviteCode }),
                  },
                });
                break;
              case "user.merged":
                await knockService.mergeUsers(
                  event.primaryUserId,
                  event.secondaryUserId
                );
                break;
              case "user.deleted":
                await knockService.deleteUser(event.userId);
                break;
            }
          }
        : undefined,
      AUTH_SECRET: env.AUTH_SECRET,
      NODE_ENV: env.NODE_ENV,
      AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY,
      TOOLS_EXA_API_KEY: env.EXA_API_KEY,
      serverVersion: "worker",
      ONBOARDING_AGENT_BUNDLE_URL:
        "https://artifacts.blink.host/starter-agent/bundle.tar.gz",
    },
    ctx
  );
}
