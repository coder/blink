import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "@blink.so/api/test";
import { createDevhookSupport } from "./devhook";

describe("devhook integration tests", () => {
  let server: Awaited<ReturnType<typeof serve>>;
  let devhookSupport: ReturnType<typeof createDevhookSupport>;

  beforeAll(async () => {
    server = await serve();

    // Create devhook support with the test server's database
    const querier = await server.bindings.database();
    devhookSupport = createDevhookSupport({
      accessUrl: server.url.toString(),
      wildcardAccessUrl: `*.${server.url.host}`,
      querier,
    });
  });

  afterAll(() => {
    server.stop();
  });

  describe("UUID validation", () => {
    test("accepts UUID v4", async () => {
      const { helpers } = server;
      const { client } = await helpers.createUser();

      const id = crypto.randomUUID();
      const url = await client.devhook.getUrl(id);
      expect(url).toBeDefined();
    });

    test("accepts UUID v7", async () => {
      const { helpers } = server;
      const { client } = await helpers.createUser();

      // UUID v7 format (timestamp-based, version 7 in 13th char)
      const id = "018e4c6a-1234-7000-8000-000000000000";
      const url = await client.devhook.getUrl(id);
      expect(url).toBeDefined();
    });

    test("rejects invalid UUID", async () => {
      const { helpers } = server;
      const { client } = await helpers.createUser();

      const id = "not-a-valid-uuid";
      await expect(client.devhook.getUrl(id)).rejects.toThrow();
    });
  });

  describe("handleRequest", () => {
    test("rejects WebSocket upgrade requests before proxying", async () => {
      const id = crypto.randomUUID();

      // Use the real createDevhookSupport handleRequest
      const req = new Request("http://localhost/test", {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
        },
      });

      const response = await devhookSupport.handleRequest(id, req);

      expect(response.status).toBe(501);
      const body = await response.json();
      expect(body.message).toBe("WebSocket proxying not supported");
    });

    test("returns 503 when devhook not connected", async () => {
      const id = crypto.randomUUID();
      const req = new Request("http://localhost/test");

      const response = await devhookSupport.handleRequest(id, req);

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.message).toBe("Devhook not connected");
    });
  });

  describe("devhook proxy flow", () => {
    test("proxies requests through connected devhook", async () => {
      const { helpers, bindings, url } = server;
      const { client } = await helpers.createUser();

      const id = crypto.randomUUID();

      let requestReceived = false;
      let receivedMethod = "";

      const connectPromise = new Promise<void>((resolve) => {
        client.devhook.listen({
          id,
          onConnect: () => resolve(),
          onError: () => {},
          onRequest: async (req) => {
            requestReceived = true;
            receivedMethod = req.method;
            return new Response("Hello from devhook!", {
              status: 200,
              headers: { "X-Custom-Header": "test-value" },
            });
          },
        });
      });

      await connectPromise;

      // Make request through wildcard hostname routing
      const devhookURL = bindings.createRequestURL!(id);
      const response = await fetch(url, {
        method: "POST",
        headers: { Host: devhookURL.host },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Hello from devhook!");
      expect(response.headers.get("X-Custom-Header")).toBe("test-value");
      expect(requestReceived).toBe(true);
      expect(receivedMethod).toBe("POST");
    });

    test("proxies request body correctly", async () => {
      const { helpers, bindings, url } = server;
      const { client } = await helpers.createUser();

      const id = crypto.randomUUID();
      let receivedBody = "";

      const connectPromise = new Promise<void>((resolve) => {
        client.devhook.listen({
          id,
          onConnect: () => resolve(),
          onError: () => {},
          onRequest: async (req) => {
            receivedBody = await req.text();
            return new Response("OK");
          },
        });
      });

      await connectPromise;

      const devhookURL = bindings.createRequestURL!(id);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Host: devhookURL.host,
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({ test: "data" }),
      });

      expect(response.status).toBe(200);
      expect(receivedBody).toBe('{"test":"data"}');
    });
  });

  describe("matchRequestHost", () => {
    test("extracts UUID from wildcard hostname", () => {
      const id = crypto.randomUUID();
      const host = `${id}.${server.url.host}`;

      const matched = devhookSupport.matchRequestHost?.(host);
      expect(matched).toBe(id);
    });

    test("returns undefined for base host", () => {
      const matched = devhookSupport.matchRequestHost?.(server.url.host);
      expect(matched).toBeUndefined();
    });

    test("returns undefined for invalid UUID subdomain", () => {
      const host = `not-a-uuid.${server.url.host}`;
      const matched = devhookSupport.matchRequestHost?.(host);
      expect(matched).toBeUndefined();
    });

    test("returns undefined for unrelated host", () => {
      const matched = devhookSupport.matchRequestHost?.("example.com");
      expect(matched).toBeUndefined();
    });
  });
});
