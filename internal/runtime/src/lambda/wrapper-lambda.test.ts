import { generateAgentInvocationToken } from "@blink.so/api/agents/me/server";
import { serve } from "@blink.so/api/test";
import {
  BlinkInvocationTokenHeader,
  InternalAPIServerListenPortEnvironmentVariable,
  InternalAPIServerURLEnvironmentVariable,
} from "@blink.so/runtime/types";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { TransformStream, WritableStream } from "node:stream/web";
import llambaWrapper from "./wrapper-lambda.generated";

let testFile: string;
let toRemove: string[];

// Track active HTTP servers so we can forcefully close them after tests
const activeServers: Set<any> = new Set();

beforeAll(async () => {
  delete process.env.ENTRYPOINT;
  testFile = join(tmpdir(), `${crypto.randomUUID()}.js`);
  await Bun.write(testFile, llambaWrapper);
  toRemove = [testFile];

  // Monkey-patch Server.prototype.listen to track all servers
  const http = await import("node:http");
  const Server = http.Server;
  const originalListen = Server.prototype.listen;
  Server.prototype.listen = function (...args: any[]) {
    activeServers.add(this);
    // @ts-ignore
    return originalListen.apply(this, args);
  };
});

const seen: number[] = [];
beforeEach(() => {
  let port = Math.floor(Math.random() * 20000 + 10000);
  while (seen.includes(port)) {
    port = Math.floor(Math.random() * 20000 + 10000);
  }
  seen.push(port);
  delete require.cache[testFile];
  process.env[InternalAPIServerListenPortEnvironmentVariable] = port.toString();
});

afterAll(async () => {
  // Close all HTTP servers created during tests
  // This is necessary because even with .unref(), servers created
  // by the lambda wrapper and fixture code can keep the process alive
  for (const server of activeServers) {
    try {
      if (server.listening) {
        server.close();
      }
    } catch (e) {
      // Ignore errors
    }
  }
  activeServers.clear();

  for (const file of toRemove) {
    await rm(file);
  }
});

test(
  "using the storage api",
  async () => {
    const { url, helpers, bindings, stop } = await serve();
    try {
      process.env[InternalAPIServerURLEnvironmentVariable] = url.toString();
      const { client } = await helpers.createUser();

      const org = await client.organizations.create({
        name: "test-org",
      });
      const agent = await client.agents.create({
        name: "test-agent",
        description: "Test Description",
        organization_id: org.id,
      });

      const deployment = await client.agents.deployments.create({
        agent_id: agent.id,
        target: "production",
        output_files: [
          {
            path: "test.js",
            data: "console.log('Hello, world!');",
          },
        ],
      });

      const target = await (
        await bindings.database()
      ).selectAgentDeploymentTargetByName(agent.id, "production");
      if (!target) {
        throw new Error("Target not found");
      }
      const token = await generateAgentInvocationToken(bindings.AUTH_SECRET, {
        agent_id: agent.id,
        agent_deployment_id: deployment.id,
        agent_deployment_target_id: target.id,
      });

      const fetch = await mockHandler(
        require.resolve("./fixtures/client-using-storage")
      );
      const resp = await fetch(
        new Request("http://localhost:3000/", {
          headers: {
            [BlinkInvocationTokenHeader]: token,
          },
        })
      );
      expect(await resp.text()).toBe("Hello, world!");
      // This test can take a lil.
    } finally {
      stop();
      // Force close all HTTP servers to prevent hanging
      // The lambda wrapper and fixture create servers that need explicit cleanup
      for (const server of activeServers) {
        try {
          if (server.listening) {
            server.close();
          }
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
      activeServers.clear();
    }
  },
  { timeout: 10_000 }
);

// mockHandler mocks out AWS Lambda's handler.
// The fixture should be the path to a TS file.
const mockHandler = async (fixture: string) => {
  let statusCode: number;
  let headers: Record<string, string>;
  let cookies: string[];

  globalThis.awslambda = {
    streamifyResponse: (h: any) => {
      return h;
    },
    HttpResponseStream: {
      from: (
        body: WritableStream,
        options: {
          statusCode: number;
          headers: Record<string, string>;
          cookies: string[];
        }
      ) => {
        statusCode = options.statusCode;
        headers = options.headers;
        cookies = options.cookies;
        return body;
      },
    },
  } as any;

  process.env.ENTRYPOINT = require.resolve(fixture);
  const result = await import(testFile);
  const handler = result.handler;

  return async (request: Request) => {
    const url = new URL(request.url);
    const event = {
      rawPath: url.pathname,
      rawQueryString: url.search,
      requestContext: {
        http: {
          method: request.method,
        },
      },
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.text(),
    };
    const transform = new TransformStream();
    handler(event, Writable.fromWeb(transform.writable), {
      getRemainingTimeInMillis: () => 10000,
    });
    return new Response(transform.readable as unknown as ReadableStream, {
      status: statusCode,
      headers: new Headers(headers),
    });
  };
};
