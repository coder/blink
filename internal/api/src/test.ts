import Client from "./client.node";
import { connectToPostgres } from "@blink.so/database/postgres";
import Querier from "@blink.so/database/querier";
import type { User } from "@blink.so/database/schema";
import { createPostgresURL, createTestUser } from "@blink.so/database/test";
import { encode } from "next-auth/jwt";
import server, { type Bindings, type Email } from "./server";
import { Worker } from "@blink.so/compute-protocol-worker";
import type { AgentStore } from "blink";

export interface PartialBindings
  extends Partial<
    Omit<
      Bindings,
      | "auth"
      | "chat"
      | "files"
      | "logs"
      | "traces"
      | "runtime"
      | "sendEmail"
      | "sendTelemetryEvent"
    >
  > {
  auth?: Partial<Bindings["auth"]>;
  chat?: Partial<Bindings["chat"]>;
  files?: Partial<Bindings["files"]>;
  logs?: Partial<Bindings["logs"]>;
  traces?: Partial<Bindings["traces"]>;
  runtime?: Partial<Bindings["runtime"]>;
  sendEmail?: Bindings["sendEmail"];
  sendTelemetryEvent?: Bindings["sendTelemetryEvent"];
}

export type ServeOptions = {
  bindings?: PartialBindings;

  onWaitUntil?: (promise: Promise<unknown>) => void;
};

export const serve = async (options?: ServeOptions) => {
  let databasePromise: Promise<Querier> | undefined;

  const authSecret = options?.bindings?.AUTH_SECRET ?? crypto.randomUUID();
  const files = new Map<string, File>();
  const devhookServers = new Map<string, Worker>();
  const srv = Bun.serve<
    | {
        type: "token";
        id: string;
      }
    | {
        type: "devhook";
        id: string;
      },
    any
  >({
    fetch: (request, srv) => {
      return server.fetch(request, bindings, {
        waitUntil: (promise) => {
          options?.onWaitUntil?.(promise);
        },
        passThroughOnException() {},
        props: {},
      });
    },
    websocket: {
      open: (ws) => {
        if (ws.data.type === "token") {
          ws.subscribe(`token:${ws.data.id}`);
        }
        if (ws.data.type === "devhook") {
          ws.subscribe(`devhook:${ws.data.id}`);
        }
      },
      message: (ws, message) => {
        if (ws.data.type === "devhook") {
          const srv = devhookServers.get(ws.data.id);
          if (srv) {
            srv.handleServerMessage(message as Uint8Array);
          }
        }
      },
    },
    port: 0,
  });
  const agentStore = new Map<string, AgentStore>();
  const bindings: Bindings = {
    apiBaseURL: srv.url,
    matchRequestHost: (hostname) => {
      const regex = new RegExp(`^(.*)\.${srv.url.host}$`);
      const exec = regex.exec(hostname);
      if (exec) {
        return exec[1];
      }
      return undefined;
    },
    createRequestURL: (id) => {
      return new URL(`http://${id}.${srv.url.host}`);
    },

    deployAgent: async (deployment) => {
      // noop - users decide in their tests
    },
    database: () => {
      if (!databasePromise) {
        databasePromise = createPostgresURL().then(async (v) => {
          return new Querier(await connectToPostgres(v));
        });
      }
      return databasePromise;
    },
    AUTH_SECRET: authSecret,
    NODE_ENV: "development",
    ...options?.bindings,
    agentStore: (targetID) => {
      let store = agentStore.get(targetID);
      if (!store) {
        const values = new Map<string, string>();
        store = {
          delete: async (key) => {
            values.delete(key);
          },
          get: async (key) => {
            return values.get(key);
          },
          set: async (key, value) => {
            values.set(key, value);
          },
          list: async (prefix, options) => {
            return {
              entries: Array.from(values.entries()).map(([key, value]) => ({
                key,
                value,
              })),
            };
          },
        };
      }
      agentStore.set(targetID, store);
      return store;
    },
    auth: {
      handleWebSocketTokenRequest: async (id, request) => {
        if (
          srv.upgrade(request, {
            data: {
              type: "token",
              id,
            },
          })
        ) {
          return new Response(null);
        }
        return new Response("Not a WebSocket", { status: 400 });
      },
      sendTokenToWebSocket: async (id, token) => {
        srv.publish(`token:${id}`, token);
      },
      ...options?.bindings?.auth,
    },
    devhook: {
      handleListen: async (id, req) => {
        if (
          !srv.upgrade(req, {
            data: {
              type: "devhook",
              id,
            },
          })
        ) {
          throw new Error("bad implementation");
        }

        const worker = new Worker({
          sendToClient(streamID, message) {
            // noop - nothing needed - no requests for devhooks
          },
          sendToServer(message) {
            srv.publish(`devhook:${id}`, message);
          },
        });
        devhookServers.set(id, worker);

        return new Response(null);
      },
      handleRequest: async (id, req) => {
        const worker = devhookServers.get(id);
        if (!worker) {
          throw new Error("no server connected");
        }

        const resp = await worker.proxy(req);
        if (resp.upgrade) {
          throw new Error("upgrade not implemented");
        }
        return new Response(resp.body ?? null, {
          status: resp.status,
          headers: resp.headers,
          statusText: resp.statusText,
        });
      },
      ...options?.bindings?.devhook,
    },
    files: {
      upload: async (opts) => {
        const id = crypto.randomUUID();
        files.set(id, opts.file);
        return {
          id,
          url: `${srv.url}/api/files/${id}`,
        };
      },
      download: async (id) => {
        const file = files.get(id);
        if (!file) {
          throw new Error("File not found");
        }
        return {
          stream: file.stream(),
          type: file.type,
          name: file.name,
          size: file.size,
        };
      },
      ...options?.bindings?.files,
    },
    chat: {
      handleStart: async (opts) => {
        // noop
      },
      handleStop: async (id) => {
        // noop
      },
      handleStream: async (id, req) => {
        throw new Error("Not implemented");
      },
      handleMessagesChanged: async (event, id, messages) => {
        // noop
      },
      ...options?.bindings?.chat,
    },
    logs: {
      get: async () => {
        throw new Error("Not implemented");
      },
      write: async (opts) => {
        // no-op
      },
      ...options?.bindings?.logs,
    },
    traces: {
      write: async () => {
        throw new Error("Not implemented");
      },
      read: async () => {
        throw new Error("Not implemented");
      },
      ...options?.bindings?.traces,
    },
    runtime: {
      usage: async () => {
        return "0.0";
      },
      ...options?.bindings?.runtime,
    },
    sendEmail:
      options?.bindings?.sendEmail ??
      (async (email) => {
        // Mock email service for tests - just log
        console.log("Mock email sent:", email.type, email.email);
      }),
    sendTelemetryEvent:
      options?.bindings?.sendTelemetryEvent ??
      (async (event) => {
        // Mock telemetry service for tests - just log
        console.log("Mock telemetry event:", event.type);
      }),
  };

  const createAuthToken = async (userID: string) => {
    const token = await encode({
      secret: authSecret,
      salt: "blink_session_token",
      token: {
        sub: userID,
      },
    });
    return token;
  };

  return {
    url: srv.url,
    bindings,
    helpers: {
      createUser: async (
        userData?: Partial<User> & {
          username?: string;
          avatar_url?: string | null;
        }
      ) => {
        const db = await bindings.database();
        const user = await createTestUser(db, userData);
        return {
          user,
          client: new Client({
            baseURL: srv.url.toString(),
            authToken: await createAuthToken(user.id),
          }),
        };
      },
    },
    stop: () => {
      srv.stop();
    },
  };
};
