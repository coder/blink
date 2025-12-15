import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DevhookClient } from "./client";
import { createLocalServer } from "./server/local";
import { generateDevhookId } from "./server/crypto";

const SERVER_SECRET = "test-server-secret";
const CLIENT_SECRET = "test-client-secret";

describe("devhook", () => {
  let server: ReturnType<typeof createLocalServer>;
  let serverPort: number;

  beforeAll(async () => {
    // Find an available port
    serverPort = 18080 + Math.floor(Math.random() * 1000);

    server = createLocalServer({
      port: serverPort,
      secret: SERVER_SECRET,
      baseUrl: `http://localhost:${serverPort}`,
      mode: "subpath",
    });

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    server?.close();
  });

  describe("crypto", () => {
    it("should generate consistent devhook IDs", async () => {
      const id1 = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      const id2 = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
      expect(id1).toMatch(/^[a-f0-9]+$/);
    });

    it("should generate different IDs for different secrets", async () => {
      const id1 = await generateDevhookId("secret1", SERVER_SECRET);
      const id2 = await generateDevhookId("secret2", SERVER_SECRET);

      expect(id1).not.toBe(id2);
    });

    it("should generate different IDs for different server secrets", async () => {
      const id1 = await generateDevhookId(CLIENT_SECRET, "server1");
      const id2 = await generateDevhookId(CLIENT_SECRET, "server2");

      expect(id1).not.toBe(id2);
    });
  });

  describe("client-server integration", () => {
    it("should connect and receive public URL", async () => {
      let connectedUrl: string | undefined;
      let connectedId: string | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async () => new Response("OK"),
        onConnect: ({ url, id }) => {
          connectedUrl = url;
          connectedId = id;
        },
      });

      const disposable = client.connect();

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(connectedUrl).toBeDefined();
      expect(connectedId).toBeDefined();
      expect(connectedId).toHaveLength(16);
      expect(connectedUrl).toContain(connectedId);

      disposable.dispose();
    });

    it("should proxy HTTP requests", async () => {
      let receivedRequest: Request | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async (req) => {
          receivedRequest = req;
          return new Response(JSON.stringify({ message: "Hello from devhook!" }), {
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Get the devhook ID
      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);

      // Make a request through the devhook
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/test/path?foo=bar`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: "test" }),
        }
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { message: string };
      expect(body).toEqual({ message: "Hello from devhook!" });

      expect(receivedRequest).toBeDefined();
      expect(receivedRequest!.method).toBe("POST");
      expect(new URL(receivedRequest!.url).pathname).toBe("/test/path");

      disposable.dispose();
    });

    it("should return 503 when no client is connected", async () => {
      const devhookId = await generateDevhookId("nonexistent-secret", SERVER_SECRET);

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/test`
      );

      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("No client connected");
    });

    it("should handle reconnection", async () => {
      let connectCount = 0;

      const createClient = () =>
        new DevhookClient({
          serverUrl: `http://localhost:${serverPort}`,
          secret: CLIENT_SECRET,
          onRequest: async () => new Response("OK"),
          onConnect: () => {
            connectCount++;
          },
        });

      // First connection
      const client1 = createClient();
      const disposable1 = client1.connect();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(connectCount).toBe(1);

      // Second connection should replace the first
      const client2 = createClient();
      const disposable2 = client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(connectCount).toBe(2);

      disposable1.dispose();
      disposable2.dispose();
    });
  });
});
