import api from "@blink.so/api/server";
import connectToPostgres from "@blink.so/database/postgres";
import Querier from "@blink.so/database/querier";
import pkg from "../package.json" with { type: "json" };
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import module from "module";
import path, { join } from "path";
import { parse } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { deployAgentWithDocker } from "./agent-deployment";
import { ChatManager } from "./chat";

type WSData = { type: "token"; id: string } | { type: "chat"; chatID: string };

interface ServerOptions {
  port: number;
  postgresUrl: string;
  authSecret: string;
  baseUrl: string;
  devProxy?: string; // e.g. "localhost:3000"
  accessUrl: string;
}

// Files are now stored in the database instead of in-memory

export async function startServer(options: ServerOptions) {
  const { port, postgresUrl, authSecret, baseUrl, accessUrl, devProxy } =
    options;

  const db = await connectToPostgres(postgresUrl);
  const querier = new Querier(db);

  // Here we find the correct directories for the site and migrations.
  let siteDir = join(import.meta.dirname, "site");
  let migrationsDir = join(import.meta.dirname, "migrations");
  if (import.meta.filename.endsWith("server.ts")) {
    // We're running in development mode, so we need to point to the dist directory.
    const distDir = join(import.meta.dirname, "..", "dist");
    if (!existsSync(distDir)) {
      throw new Error(
        `Dist directory not found: ${distDir}. Run 'bun run build' to build the server.`
      );
    }
    siteDir = join(distDir, "site");
    migrationsDir = join(distDir, "migrations");
  }

  // Run database migrations...
  await migrate(db, { migrationsFolder: migrationsDir });

  // Create a unified request handler - either Next.js directly or dev proxy
  let handleSiteRequest: (
    req: IncomingMessage,
    res: ServerResponse
  ) => Promise<void>;

  if (devProxy) {
    handleSiteRequest = (req, res) => proxyToNextDev(req, res, devProxy);
  } else {
    const app = await startNextServer({
      siteDir,
      postgresUrl,
      authSecret,
      baseUrl,
    });
    await app.prepare();
    handleSiteRequest = app.getRequestHandler();
  }

  const chatManagerRef: { current?: ChatManager } = {};

  // Store WebSocket metadata without monkey-patching
  const wsDataMap = new WeakMap<WebSocket, WSData>();

  // Create WebSocket server first (needed in api.fetch below)
  const wss = new WebSocketServer({ noServer: true });

  // Helper to convert Node.js request to Fetch Request
  const toFetchRequest = (nodeReq: IncomingMessage): Request => {
    const protocol = "http";
    const host = nodeReq.headers.host || `localhost:${port}`;
    const fullUrl = `${protocol}://${host}${nodeReq.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    // Node.js IncomingMessage is a ReadableStream but needs type assertion
    // for the Fetch API Request constructor
    const body =
      nodeReq.method !== "GET" && nodeReq.method !== "HEAD"
        ? (nodeReq as any)
        : undefined;

    return new Request(fullUrl, {
      method: nodeReq.method,
      headers,
      body,
      // @ts-ignore - this is a NodeJS thing.
      duplex: "half",
    });
  };

  // Create HTTP server
  const server = createServer(async (nodeReq, nodeRes) => {
    try {
      const url = new URL(
        nodeReq.url || "/",
        `http://${nodeReq.headers.host || `localhost:${port}`}`
      );

      if (url.pathname.startsWith("/api")) {
        const req = toFetchRequest(nodeReq);
        const response = await api.fetch(
          req,
          {
            AUTH_SECRET: authSecret,
            NODE_ENV: "development",
            serverVersion: pkg.version,
            ONBOARDING_AGENT_BUNDLE_URL:
              "https://artifacts.blink.host/starter-agent/bundle.tar.gz",
            agentStore: (deploymentTargetID) => {
              return {
                delete: async (key) => {
                  await querier.deleteAgentStorageKV({
                    deployment_target_id: deploymentTargetID,
                    key,
                  });
                },
                get: async (key) => {
                  const value = await querier.selectAgentStorageKV({
                    deployment_target_id: deploymentTargetID,
                    key,
                  });
                  if (!value) {
                    return undefined;
                  }
                  return value.value;
                },
                set: async (key, value) => {
                  const target =
                    await querier.selectAgentDeploymentTargetByID(
                      deploymentTargetID
                    );
                  if (!target) {
                    throw new Error("Deployment target not found");
                  }
                  await querier.upsertAgentStorageKV({
                    agent_deployment_target_id: target.id,
                    agent_id: target.agent_id,
                    key: key,
                    value: value,
                  });
                },
                list: async (prefix, options) => {
                  const values = await querier.selectAgentStorageKVByPrefix({
                    deployment_target_id: deploymentTargetID,
                    prefix: prefix ?? "",
                    limit: options?.limit ?? 100,
                    cursor: options?.cursor,
                  });
                  return {
                    entries: values.items.map((value) => ({
                      key: value.key,
                      value: value.value,
                    })),
                    cursor: values.next_cursor ? values.next_cursor : undefined,
                  };
                },
              };
            },
            database: async () => {
              return querier;
            },
            apiBaseURL: url,
            accessUrl: new URL(accessUrl),
            auth: {
              handleWebSocketTokenRequest: async (id, request) => {
                // WebSocket upgrades are handled in the 'upgrade' event
                return new Response(null, { status: 101 });
              },
              sendTokenToWebSocket: async (id, token) => {
                wss.clients.forEach((client) => {
                  const data = wsDataMap.get(client);
                  if (
                    client.readyState === WebSocket.OPEN &&
                    data?.type === "token" &&
                    data.id === id
                  ) {
                    client.send(token);
                    client.close();
                  }
                });
              },
            },
            chat: {
              async handleMessagesChanged(event, id, messages) {
                await chatManagerRef.current?.handleMessagesChanged(
                  event,
                  id,
                  messages
                );
              },
              handleStart: async (opts) => {
                await chatManagerRef.current?.handleStart(opts);
              },
              handleStop: async (id) => {
                await chatManagerRef.current?.handleStop(id);
              },
              handleStream: async (id, req) => {
                if (!chatManagerRef.current) {
                  return new Response("Server not ready", { status: 503 });
                }
                // WebSocket upgrades are handled in the 'upgrade' event
                if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
                  return new Response(null, { status: 101 });
                }
                return await chatManagerRef.current.handleStream(id, req);
              },
              generateTitle: async (opts) => {
                // noop
              },
            },
            deployAgent: async (deployment) => {
              await deployAgentWithDocker({
                image:
                  process.env.BLINK_AGENT_IMAGE ??
                  "ghcr.io/coder/blink-agent:latest",
                deployment,
                querier,
                baseUrl,
                authSecret,
                downloadFile: async (id: string) => {
                  const file = await querier.selectFileByID(id);
                  if (!file || !file.content) {
                    throw new Error("File not found");
                  }

                  // Convert buffer back to ReadableStream
                  const stream = new ReadableStream({
                    start(controller) {
                      controller.enqueue(file.content);
                      controller.close();
                    },
                  });

                  return {
                    stream,
                    type: file.content_type,
                    name: file.name,
                    size: file.byte_length,
                  };
                },
              });
            },
            files: {
              upload: async (opts) => {
                const id = crypto.randomUUID();

                // Read file content into buffer
                const arrayBuffer = await opts.file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Store file in database
                await querier.insertFile({
                  id,
                  name: opts.file.name,
                  message_id: null,
                  user_id: null,
                  organization_id: null,
                  content_type: opts.file.type,
                  byte_length: opts.file.size,
                  pdf_page_count: null,
                  content: buffer,
                });

                return {
                  id,
                  url: `${baseUrl}/api/files/${id}`,
                };
              },
              download: async (id) => {
                const file = await querier.selectFileByID(id);
                if (!file || !file.content) {
                  throw new Error("File not found");
                }

                // Convert buffer back to ReadableStream
                const stream = new ReadableStream({
                  start(controller) {
                    controller.enqueue(file.content);
                    controller.close();
                  },
                });

                return {
                  stream,
                  type: file.content_type,
                  name: file.name,
                  size: file.byte_length,
                };
              },
            },
            logs: {
              get: async (opts) => {
                return querier.getAgentLogs(opts);
              },
              write: async (opts) => {
                await querier.writeAgentLog(opts);
              },
            },
            traces: {
              write: async (spans) => {
                await querier.writeAgentTraces(spans);
              },
              read: async (opts) => {
                return querier.readAgentTraces(opts);
              },
            },
            runtime: {
              usage: async (opts) => {
                // noop
                throw new Error("Not implemented");
              },
            },
          },
          {
            waitUntil: async (promise) => {
              // noop
            },
            passThroughOnException: () => {
              // noop
            },
            props: {},
          }
        );

        // Write Fetch Response to Node.js response
        const headersObj: Record<string, string | string[]> = {};
        response.headers.forEach((value, key) => {
          const existing = headersObj[key];
          if (existing) {
            if (Array.isArray(existing)) {
              existing.push(value);
            } else {
              headersObj[key] = [existing, value];
            }
          } else {
            headersObj[key] = value;
          }
        });
        nodeRes.writeHead(response.status, response.statusText, headersObj);

        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            nodeRes.write(value);
          }
        }
        nodeRes.end();
        return;
      }

      // Handle Next.js routes
      await handleSiteRequest(nodeReq, nodeRes);
    } catch (error) {
      console.error("Request error:", error);
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { "Content-Type": "text/plain" });
        nodeRes.end("Internal Server Error");
      }
    }
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (request, socket, head) => {
    const { pathname, query } = parse(request.url || "", true);

    // In dev mode, proxy Next.js HMR WebSocket
    if (devProxy && pathname === "/_next/webpack-hmr") {
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        const nextUrl = new URL(request.url || "/", `ws://${devProxy}`);
        const nextWs = new WebSocket(nextUrl);

        nextWs.on("open", () => {
          // Forward messages from Next to browser (preserve binary format)
          nextWs.on("message", (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: isBinary });
            }
          });

          // Forward messages from browser to Next
          clientWs.on("message", (data, isBinary) => {
            if (nextWs.readyState === WebSocket.OPEN) {
              nextWs.send(data, { binary: isBinary });
            }
          });
        });

        nextWs.on("close", () => clientWs.close());
        clientWs.on("close", () => nextWs.close());

        nextWs.on("error", () => clientWs.close());
        clientWs.on("error", () => nextWs.close());
      });
      return;
    }

    // Check if this is a token auth WebSocket
    if (pathname?.startsWith("/api/auth/token")) {
      const id = query.id as string;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wsDataMap.set(ws, { type: "token", id });
        wss.emit("connection", ws, request);
      });
      return;
    }

    // Check if this is a chat WebSocket
    const chatMatch = pathname?.match(/\/api\/chats\/([^/]+)\/stream/);
    if (chatMatch?.[1]) {
      const chatID = chatMatch[1];
      wss.handleUpgrade(request, socket, head, (ws) => {
        wsDataMap.set(ws, { type: "chat", chatID });
        wss.emit("connection", ws, request);
      });
      return;
    }

    socket.destroy();
  });

  wss.on("connection", (ws) => {
    const data = wsDataMap.get(ws);

    if (data?.type === "chat") {
      // Send buffered chunk events to reconnecting client
      chatManagerRef.current?.sendBufferedEventsToWebSocket(data.chatID, ws);
    }

    ws.on("close", () => {
      wsDataMap.delete(ws);
    });
  });

  chatManagerRef.current = new ChatManager(
    wss,
    wsDataMap,
    async () => {
      return querier;
    },
    process.env as Record<string, string>
  );

  server.listen(port);

  return server;
}

/**
 * Proxy HTTP requests to a Next.js dev server
 */
async function proxyToNextDev(
  nodeReq: IncomingMessage,
  nodeRes: import("http").ServerResponse,
  proxyTarget: string
) {
  try {
    const rawPath = nodeReq.url || "/";
    const base = new URL(`http://${proxyTarget}`);
    const safeUrl = new URL(rawPath, base);

    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    const body =
      nodeReq.method !== "GET" && nodeReq.method !== "HEAD"
        ? (nodeReq as unknown as BodyInit)
        : undefined;

    const response = await fetch(safeUrl.toString(), {
      method: nodeReq.method,
      headers,
      body,
      // @ts-ignore - Node.js specific option for streaming request body
      duplex: "half",
    });

    // Write response headers, excluding encoding headers since fetch auto-decompresses
    const responseHeaders: Record<string, string | string[]> = {};
    response.headers.forEach((value, key) => {
      // Skip headers that are invalid after fetch auto-decompresses the response
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "content-encoding" ||
        lowerKey === "content-length" ||
        lowerKey === "transfer-encoding"
      ) {
        return;
      }
      responseHeaders[key] = value;
    });
    nodeRes.writeHead(response.status, responseHeaders);

    // Stream response body
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
    }
    nodeRes.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    nodeRes.writeHead(502, { "Content-Type": "text/plain" });
    nodeRes.end(
      `Proxy error: ${message}. Is 'next dev' running on ${proxyTarget}?`
    );
  }
}

export interface StartNextServerOptions {
  siteDir: string;

  postgresUrl: string;
  authSecret: string;
  baseUrl: string;
}

/**
 * startNextServer starts the Next.js server.
 * It does this in a kinda convoluted way because we use the standalone
 * mode but want to handle all the routes ourselves, not having it listen
 * on it's own port and such.
 */
const startNextServer = async (opts: StartNextServerOptions) => {
  // createRequire needs a filename (not directory) to establish module resolution context.
  // We create a minimal package.json in the site dir during build for this purpose.
  const packageJsonPath = path.join(opts.siteDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `package.json not found at ${packageJsonPath}. Make sure you built with BUILD_SITE=1.`
    );
  }
  const customRequire = module.createRequire(packageJsonPath);

  // These are env vars that the server needs to run.
  // We could technically make these use the same DB instance somehow.
  process.env.POSTGRES_URL = opts.postgresUrl;
  process.env.AUTH_SECRET = opts.authSecret;
  process.env.NEXT_PUBLIC_BASE_URL = opts.baseUrl;

  let nextConfig: any = {};
  try {
    const content = await readFile(
      path.join(opts.siteDir, ".next", "required-server-files.json"),
      "utf-8"
    );
    nextConfig = JSON.parse(content).config;
  } catch (err) {
    throw new Error(
      `dev error: required next config file not found at ${path.join(opts.siteDir, ".next", "required-server-files.json")}: ${err}`
    );
  }
  // This is required for Next to not freak out about not having a config.
  // Their standalone generated file does exactly this.
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

  const next = customRequire("next") as typeof import("next").default;
  const app = next({
    dev: false,
    dir: opts.siteDir,
  });
  return app;
};
