// This is imported by the generated wrapper files.
// It should be *very* cautious about what it imports,
// as we don't want that bundle to be too large.

import AgentInvocationClient from "@blink.so/api/agents/me";
import { createServerAdapter } from "@whatwg-node/server";
import type { AgentChat, AgentOtel, AgentStore, ID } from "blink";
import { APIServerURLEnvironmentVariable } from "blink/client";
import { api } from "blink/control";
import { getAuthToken } from "blink/internal";
import { createServer, Server } from "node:http";
import {
  BlinkDeploymentTokenEnvironmentVariable,
  BlinkInvocationAuthTokenEnvironmentVariable,
  InternalAPIServerListenPortEnvironmentVariable,
  InternalAPIServerURLEnvironmentVariable,
} from "./types";

/**
 * Header used to pass auth token to the internal API server.
 * The wrapper patches fetch to add this header for internal API requests.
 */
export const InternalAuthHeader = "x-blink-internal-auth";

/**
 * Patches globalThis.fetch to automatically add the auth token header
 * for requests to the internal API server. This allows the auth token
 * to cross the HTTP boundary from agent code to the internal API.
 *
 * Uses AsyncLocalStorage context (getAuthToken) as the primary source,
 * with fallback to legacy environment variable for older blink package versions.
 */
export function patchFetchWithAuth(internalAPIOrigin: string): void {
  const originalFetch = globalThis.fetch;
  const patchedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(internalAPIOrigin)) {
      // Try ALS context first, fall back to legacy env var for older blink versions
      const authToken =
        getAuthToken() ??
        process.env[BlinkInvocationAuthTokenEnvironmentVariable];
      if (authToken) {
        const headers = new Headers(init?.headers);
        headers.set(InternalAuthHeader, authToken);
        init = { ...init, headers };
      }
    }
    return originalFetch(input, init);
  };
  // Preserve any static properties (e.g., Bun's fetch.preconnect)
  Object.assign(patchedFetch, originalFetch);
  globalThis.fetch = patchedFetch as typeof fetch;
}

/**
 * Starts the internal API server that routes internal Blink APIs to use
 * the Blink Cloud API server.
 *
 * @returns The server and port information.
 */
export async function startInternalAPIServer() {
  // Start the API server that routes internal Blink APIs to use
  // the Blink Cloud API server.
  const port = process.env[InternalAPIServerListenPortEnvironmentVariable]
    ? parseInt(process.env[InternalAPIServerListenPortEnvironmentVariable], 10)
    : 12345;

  const server = createServer(
    createServerAdapter((request) => {
      // Extract auth token from request header.
      // This is passed by the patched fetch in the wrapper.
      const authToken = request.headers.get(InternalAuthHeader) ?? undefined;

      // Create a client for this specific request with its auth token
      const client = new AgentInvocationClient({
        baseURL: process.env[InternalAPIServerURLEnvironmentVariable],
        authToken,
        deploymentToken: process.env[BlinkDeploymentTokenEnvironmentVariable],
      });

      // Create request-scoped bindings that use this client
      const store: AgentStore = {
        get(key) {
          return client.getStorage(key);
        },
        set(key, value) {
          return client.setStorage(key, value);
        },
        delete(key) {
          return client.deleteStorage(key);
        },
        list(prefix, options) {
          return client.listStorage(prefix, options);
        },
      };

      const otlp: AgentOtel = {
        traces(req) {
          return client.proxyOtlpTraces(req);
        },
      };

      const chat: AgentChat = {
        upsert: async (key) => {
          const resp = await client.upsertChat(JSON.stringify(key));
          return {
            created: resp.created,
            id: resp.id as ID,
            createdAt: resp.created_at,
          };
        },
        delete: async (id) => {
          await client.deleteChat(id);
        },
        deleteMessages: async (id, messageIds) => {
          await client.deleteMessages(id, messageIds);
        },
        get: async (id) => {
          const resp = await client.getChat(id);
          if (!resp) {
            return undefined;
          }
          return {
            id: resp.id as ID,
            createdAt: resp.createdAt,
          };
        },
        getMessages: async (id) => {
          const messages = await client.getMessages(id);
          return messages.map((message) => ({
            id: message.id as ID,
            role: message.role,
            parts: message.parts,
            metadata: message.metadata,
          }));
        },
        start: async (id) => {
          await client.startChat(id);
        },
        stop: async (id) => {
          await client.stopChat(id);
        },
        sendMessages: async (id, messages, options) => {
          await client.sendMessages(id, {
            messages: messages.map((msg) => ({
              id: msg.id,
              role: msg.role,
              parts: msg.parts,
              metadata: msg.metadata,
            })),
            behavior: options?.behavior ?? "enqueue",
          });
        },
      };

      return api.fetch(request, {
        chat,
        store,
        otlp,
      });
    })
  );

  const actualPort = await new Promise<number>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (address && typeof address !== "string") {
        resolve(address.port);
      } else {
        resolve(port);
      }
    });
  });

  // This is for the agents to know where to send requests to.
  process.env[APIServerURLEnvironmentVariable] =
    `http://127.0.0.1:${actualPort}`;

  return {
    server,
    port: actualPort,
  };
}

export async function startAgentServer(
  entrypoint: string,
  port: number,
  unref: boolean = false
) {
  const priorEnvPort = process.env.PORT;
  process.env.PORT = port.toString();

  const originalListen = Server.prototype.listen;
  let restored = false;
  const restoreListen = () => {
    if (!restored) {
      Server.prototype.listen = originalListen;
      restored = true;
    }
  };

  const listeningPromise = new Promise<number>((resolve, reject) => {
    Server.prototype.listen = function (...args) {
      this.once("listening", () => {
        const address = this.address();
        const resolvedPort =
          address && typeof address !== "string" ? address.port : port;
        restoreListen();
        resolve(resolvedPort);
      });
      this.once("error", (err) => {
        restoreListen();
        reject(err);
      });
      if (unref) {
        this.unref();
      }
      // @ts-ignore
      return originalListen.apply(this, args);
    };
  });

  // The server starts immediately, so we don't need to wait for it.
  try {
    await import(entrypoint);
  } catch (error) {
    restoreListen();
    throw error;
  } finally {
    process.env.PORT = priorEnvPort;
  }

  const actualPort = await listeningPromise;
  const agentUrl = `http://127.0.0.1:${actualPort}`;
  const handler = createServerAdapter((request) => {
    const reqURL = new URL(request.url);
    const newURL = new URL(agentUrl);
    newURL.pathname = reqURL.pathname;
    newURL.search = reqURL.search;

    // Add auth header to the proxied request so the agent code can access it.
    // The agent's internal API requests will include this header.
    const authToken = getAuthToken();
    const headers = new Headers(request.headers);
    if (authToken) {
      headers.set(InternalAuthHeader, authToken);
    }

    return fetch(newURL.toString(), {
      method: request.method,
      headers,
      body: request.body,
      // @ts-ignore - duplex is needed for streaming bodies
      duplex: "half",
    });
  });
  return { handler, port: actualPort };
}
