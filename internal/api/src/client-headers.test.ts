import { InternalAPIServerHeadersEnvironmentVariable } from "@blink.so/runtime/types";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import BrowserClient from "./client.browser";
import Client from "./client.node";
import AgentInvocationClient from "./routes/agents/me/me.client";

const extraHeaders = {
  "X-Custom-Header": "custom-value",
  "X-Another-Header": "another-value",
  Authorization: "must-not-replace-blink-token",
};
let previousHeaders: string | undefined;

beforeEach(() => {
  previousHeaders = process.env[InternalAPIServerHeadersEnvironmentVariable];
  process.env[InternalAPIServerHeadersEnvironmentVariable] =
    JSON.stringify(extraHeaders);
});

afterEach(() => {
  if (previousHeaders === undefined) {
    delete process.env[InternalAPIServerHeadersEnvironmentVariable];
  } else {
    process.env[InternalAPIServerHeadersEnvironmentVariable] = previousHeaders;
  }
});

describe("Blink server headers", () => {
  test("runtime callbacks include extra headers and keep invocation and deployment authentication", async () => {
    const requests: Headers[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push(new Headers(request.headers));
        if (request.url.endsWith("/api/otlp/v1/traces")) {
          expect(await request.text()).toBe("trace-body");
          return Response.json({});
        }
        return new Response(null, { status: 204 });
      },
    });
    try {
      const client = new AgentInvocationClient({
        baseURL: server.url.toString(),
        authToken: "invocation",
        deploymentToken: "deployment",
      });
      await client.setStorage("key", "value");
      await client.sendMessages("chat", { messages: [], behavior: "enqueue" });
      const response = await client.proxyOtlpTraces(
        new Request("http://localhost/otlp/v1/traces", {
          method: "POST",
          body: "trace-body",
          headers: { "content-type": "application/x-protobuf" },
        })
      );
      expect(response.status).toBe(200);
      expect(requests).toHaveLength(3);
      for (const headers of requests) {
        expect(headers.get("X-Custom-Header")).toBe("custom-value");
        expect(headers.get("X-Another-Header")).toBe("another-value");
      }
      expect(requests.map((headers) => headers.get("authorization"))).toEqual([
        "Bearer invocation",
        "Bearer invocation",
        "Bearer deployment",
      ]);
      expect(requests[2]!.get("content-type")).toBe("application/x-protobuf");
    } finally {
      server.stop(true);
    }
  });

  test("Node HTTP clients merge explicit headers case-insensitively without affecting browser clients", async () => {
    const requests: Headers[] = [];
    const capture = (async (_url, init) => {
      requests.push(new Headers(init?.headers));
      return new Response();
    }) as typeof fetch;
    const client = new Client({
      authToken: "blink-token",
      headers: { "x-custom-header": "explicit-value" },
      fetch: capture,
    });
    await client.request("GET", "/api/test");
    await new BrowserClient({ fetch: capture }).request("GET", "/api/test");
    expect(requests[0]!.get("X-Custom-Header")).toBe("explicit-value");
    expect(requests[0]!.get("X-Another-Header")).toBe("another-value");
    expect(requests[0]!.get("authorization")).toBe("Bearer blink-token");
    expect(requests[1]!.has("X-Another-Header")).toBe(false);
  });

  test("Node WebSocket handshakes include extra headers and Blink authentication", async () => {
    const server = Bun.serve<{ headers: Record<string, string> }, {}>({
      port: 0,
      fetch(request, server) {
        if (
          server.upgrade(request, {
            data: { headers: Object.fromEntries(request.headers) },
          })
        ) {
          return;
        }
        return new Response(null, { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify(ws.data.headers));
        },
        message() {},
      },
    });
    const client = new Client({
      baseURL: server.url.toString(),
      authToken: "blink-token",
    });
    const ws = client.websocket("/api/tools/compute/connect");
    try {
      const headers = await new Promise<Record<string, string>>(
        (resolve, reject) => {
          ws.onmessage = (event) => resolve(JSON.parse(String(event.data)));
          ws.onerror = reject;
        }
      );
      expect(headers["x-custom-header"]).toBe("custom-value");
      expect(headers["x-another-header"]).toBe("another-value");
      expect(headers.authorization).toBe("Bearer blink-token");
    } finally {
      ws.close();
      server.stop(true);
    }
  });

  test.each([
    "{secret",
    "null",
    "[]",
    '"secret"',
    '{"x-secret":42}',
    '{"bad name":"secret"}',
    '{"x-secret":"secret\\nvalue"}',
  ])("rejects invalid configuration without exposing it: %s", (value) => {
    process.env[InternalAPIServerHeadersEnvironmentVariable] = value;
    expect(() => new AgentInvocationClient()).toThrow(
      "INTERNAL_BLINK_API_SERVER_HEADERS must be a JSON object of valid HTTP header names and string values"
    );
  });

  test("unset configuration leaves existing behavior intact", async () => {
    delete process.env[InternalAPIServerHeadersEnvironmentVariable];
    const client = new Client({
      authToken: "blink-token",
      fetch: (async (_url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.has("X-Another-Header")).toBe(false);
        expect(headers.get("authorization")).toBe("Bearer blink-token");
        return new Response();
      }) as typeof fetch,
    });
    await client.request("GET", "/api/test");
  });
});
