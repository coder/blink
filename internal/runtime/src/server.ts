// This is imported by the generated wrapper files.
// It should be *very* cautious about what it imports,
// as we don't want that bundle to be too large.

import AgentInvocationClient from "@blink.so/api/agents/me";
import { createServerAdapter } from "@whatwg-node/server";
import type { AgentChat, AgentOtel, AgentStore, ID } from "blink";
import { APIServerURLEnvironmentVariable } from "blink/client";
import { api } from "blink/control";
import { createServer, Server } from "node:http";
import {
  InternalAPIServerListenPortEnvironmentVariable,
  InternalAPIServerURLEnvironmentVariable,
} from "./types";

/**
 * Starts the internal API server that routes internal Blink APIs to use
 * the Blink Cloud API server.
 *
 * @returns A function to set the authentication token.
 */
export function startInternalAPIServer() {
  let blinkAuthToken: string | undefined;

  const getClient = () => {
    return new AgentInvocationClient({
      baseURL: process.env[InternalAPIServerURLEnvironmentVariable],
      authToken: blinkAuthToken,
    });
  };

  // Start the API server that routes internal Blink APIs to use
  // the Blink Cloud API server.
  const port = process.env[InternalAPIServerListenPortEnvironmentVariable]
    ? parseInt(process.env[InternalAPIServerListenPortEnvironmentVariable])
    : 12345;

  const store: AgentStore = {
    get(key) {
      return getClient().getStorage(key);
    },
    set(key, value) {
      return getClient().setStorage(key, value);
    },
    delete(key) {
      return getClient().deleteStorage(key);
    },
    list(prefix, options) {
      return getClient().listStorage(prefix, options);
    },
  };
  const otlp: AgentOtel = {
    traces(request) {
      return getClient().proxyOtlpTraces(request);
    },
  };

  const chat: AgentChat = {
    upsert: async (key) => {
      const resp = await getClient().upsertChat(JSON.stringify(key));
      return {
        created: resp.created,
        id: resp.id as ID,
        createdAt: resp.created_at,
      };
    },
    delete: async (id) => {
      await getClient().deleteChat(id);
    },
    deleteMessages: async (id, messageIds) => {
      await getClient().deleteMessages(id, messageIds);
    },
    get: async (id) => {
      const resp = await getClient().getChat(id);
      if (!resp) {
        return undefined;
      }
      return {
        id: resp.id as ID,
        createdAt: resp.createdAt,
      };
    },
    getMessages: async (id) => {
      const messages = await getClient().getMessages(id);
      return messages.map((message) => ({
        id: message.id as ID,
        role: message.role,
        parts: message.parts,
        metadata: message.metadata,
      }));
    },
    start: async (id) => {
      await getClient().startChat(id);
    },
    stop: async (id) => {
      await getClient().stopChat(id);
    },
    sendMessages: async (id, messages, options) => {
      await getClient().sendMessages(id, {
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
  const server = createServer(
    createServerAdapter((request) => {
      return api.fetch(request, {
        chat,
        store,
        otlp,
      });
    })
  );
  server.listen(port, "127.0.0.1");
  // This is for the agents to know where to send requests to.
  process.env[APIServerURLEnvironmentVariable] = `http://127.0.0.1:${port}`;

  return {
    server,
    port,
    setAuthToken(authToken: string) {
      blinkAuthToken = authToken;
      // This is an environment variable that is used by SDKs
      // to send authenticated requests to the API.
      process.env["BLINK_INVOCATION_AUTH_TOKEN"] = authToken;
    },
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
  const listeningPromise = new Promise<void>((resolve, reject) => {
    Server.prototype.listen = function (...args) {
      this.on("listening", () => {
        resolve(undefined);
      });
      this.on("error", (err) => {
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
  await import(entrypoint);
  process.env.PORT = priorEnvPort;

  const agentUrl = `http://127.0.0.1:${port}`;
  const handler = createServerAdapter((request) => {
    const reqURL = new URL(request.url);
    const newURL = new URL(agentUrl);
    newURL.pathname = reqURL.pathname;
    newURL.search = reqURL.search;
    return fetch(newURL.toString(), request);
  });
  await listeningPromise;
  return handler;
}
