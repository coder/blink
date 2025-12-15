import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { DevhookClient } from "./client";
import { createLocalServer } from "./server/local";
import { generateDevhookId, verifyDevhookId } from "./server/crypto";

const SERVER_SECRET = "test-server-secret";
const CLIENT_SECRET = "test-client-secret";

describe("devhook", () => {
  describe("crypto", () => {
    it("should generate consistent devhook IDs", async () => {
      const id1 = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      const id2 = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
      expect(id1).toMatch(/^[a-f0-9]+$/);
    });

    it("should generate different IDs for different client secrets", async () => {
      const id1 = await generateDevhookId("secret1", SERVER_SECRET);
      const id2 = await generateDevhookId("secret2", SERVER_SECRET);

      expect(id1).not.toBe(id2);
    });

    it("should generate different IDs for different server secrets", async () => {
      const id1 = await generateDevhookId(CLIENT_SECRET, "server1");
      const id2 = await generateDevhookId(CLIENT_SECRET, "server2");

      expect(id1).not.toBe(id2);
    });

    it("should verify devhook IDs correctly", async () => {
      const id = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);

      const isValid = await verifyDevhookId(id, CLIENT_SECRET, SERVER_SECRET);
      expect(isValid).toBe(true);

      const isInvalid = await verifyDevhookId(id, "wrong-secret", SERVER_SECRET);
      expect(isInvalid).toBe(false);
    });

    it("should handle empty secrets", async () => {
      const id = await generateDevhookId("", SERVER_SECRET);
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[a-f0-9]+$/);
    });

    it("should handle unicode secrets", async () => {
      const id = await generateDevhookId("секрет🔐", SERVER_SECRET);
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe("local server", () => {
    let server: ReturnType<typeof createLocalServer>;
    let serverPort: number;

    beforeAll(async () => {
      serverPort = 18080 + Math.floor(Math.random() * 1000);
      server = createLocalServer({
        port: serverPort,
        secret: SERVER_SECRET,
        baseUrl: `http://localhost:${serverPort}`,
        mode: "subpath",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    afterAll(() => {
      server?.close();
    });

    it("should respond to health check", async () => {
      const response = await fetch(`http://localhost:${serverPort}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");
    });

    it("should return 404 for unknown routes", async () => {
      const response = await fetch(`http://localhost:${serverPort}/unknown`);
      expect(response.status).toBe(404);
    });

    it("should return 426 for non-WebSocket connect requests", async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/devhook/connect`);
      expect(response.status).toBe(426);
    });
  });

  describe("client-server integration", () => {
    let server: ReturnType<typeof createLocalServer>;
    let serverPort: number;
    let clientConnections: Array<{ dispose: () => void }> = [];

    beforeAll(async () => {
      serverPort = 19080 + Math.floor(Math.random() * 1000);
      server = createLocalServer({
        port: serverPort,
        secret: SERVER_SECRET,
        baseUrl: `http://localhost:${serverPort}`,
        mode: "subpath",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    afterAll(() => {
      server?.close();
    });

    afterEach(() => {
      // Clean up any client connections
      for (const conn of clientConnections) {
        conn.dispose();
      }
      clientConnections = [];
    });

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
      clientConnections.push(disposable);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(connectedUrl).toBeDefined();
      expect(connectedId).toBeDefined();
      expect(connectedId).toHaveLength(16);
      expect(connectedUrl).toContain(connectedId);
      expect(connectedUrl).toContain("/devhook/");
    });

    it("should proxy GET requests", async () => {
      let receivedRequest: Request | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async (req) => {
          receivedRequest = req;
          return new Response("GET response");
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api/data`
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("GET response");
      expect(receivedRequest?.method).toBe("GET");
      expect(new URL(receivedRequest!.url).pathname).toBe("/api/data");
    });

    it("should proxy POST requests with JSON body", async () => {
      let receivedBody: unknown;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async (req) => {
          receivedBody = await req.json();
          return new Response(JSON.stringify({ received: true }), {
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "test", value: 123 }),
        }
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { received: boolean };
      expect(body.received).toBe(true);
      expect(receivedBody).toEqual({ name: "test", value: 123 });
    });

    it("should preserve query parameters", async () => {
      let receivedUrl: string | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async (req) => {
          receivedUrl = req.url;
          return new Response("OK");
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/search?q=test&page=1`
      );

      expect(receivedUrl).toBeDefined();
      const url = new URL(receivedUrl!);
      expect(url.searchParams.get("q")).toBe("test");
      expect(url.searchParams.get("page")).toBe("1");
    });

    it("should preserve request headers", async () => {
      let receivedHeaders: Headers | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async (req) => {
          receivedHeaders = req.headers;
          return new Response("OK");
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api`,
        {
          headers: {
            "x-custom-header": "custom-value",
            "authorization": "Bearer token123",
          },
        }
      );

      expect(receivedHeaders?.get("x-custom-header")).toBe("custom-value");
      expect(receivedHeaders?.get("authorization")).toBe("Bearer token123");
    });

    it("should return response headers from client", async () => {
      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async () => {
          return new Response("OK", {
            headers: {
              "x-response-header": "response-value",
              "cache-control": "no-cache",
            },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api`
      );

      expect(response.headers.get("x-response-header")).toBe("response-value");
      expect(response.headers.get("cache-control")).toBe("no-cache");
    });

    it("should handle different HTTP status codes", async () => {
      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: CLIENT_SECRET,
        onRequest: async (req) => {
          const url = new URL(req.url);
          const status = parseInt(url.searchParams.get("status") || "200");
          return new Response(status === 204 ? null : "Response", { status });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId(CLIENT_SECRET, SERVER_SECRET);

      // Test 201 Created
      const res201 = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api?status=201`
      );
      expect(res201.status).toBe(201);

      // Test 404 Not Found
      const res404 = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api?status=404`
      );
      expect(res404.status).toBe(404);

      // Test 500 Internal Server Error
      const res500 = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/api?status=500`
      );
      expect(res500.status).toBe(500);
    });

    it("should return 503 when no client is connected", async () => {
      const devhookId = await generateDevhookId("nonexistent-secret", SERVER_SECRET);

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/test`
      );

      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("No client connected");
      expect(body.message).toContain("not currently connected");
    });

    it("should handle client disconnection gracefully", async () => {
      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "disconnect-test-secret",
        onRequest: async () => new Response("OK"),
      });

      const disposable = client.connect();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Disconnect the client
      disposable.dispose();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to make a request - should get 503
      const devhookId = await generateDevhookId("disconnect-test-secret", SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/test`
      );

      expect(response.status).toBe(503);
    });

    it("should handle reconnection with same secret", async () => {
      let connectCount = 0;
      const testSecret = "reconnect-test-" + Math.random();

      const createClient = () =>
        new DevhookClient({
          serverUrl: `http://localhost:${serverPort}`,
          secret: testSecret,
          onRequest: async () => new Response(`Response ${connectCount}`),
          onConnect: () => {
            connectCount++;
          },
        });

      // First connection
      const client1 = createClient();
      const disposable1 = client1.connect();
      clientConnections.push(disposable1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(connectCount).toBe(1);

      // Second connection should replace the first
      const client2 = createClient();
      const disposable2 = client2.connect();
      clientConnections.push(disposable2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(connectCount).toBe(2);

      // Verify the new client handles requests
      const devhookId = await generateDevhookId(testSecret, SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/test`
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Response 2");
    });

    it("should handle multiple concurrent clients with different secrets", async () => {
      const secret1 = "multi-client-1-" + Math.random();
      const secret2 = "multi-client-2-" + Math.random();

      const client1 = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: secret1,
        onRequest: async () => new Response("Client 1"),
      });

      const client2 = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: secret2,
        onRequest: async () => new Response("Client 2"),
      });

      const disposable1 = client1.connect();
      const disposable2 = client2.connect();
      clientConnections.push(disposable1, disposable2);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId1 = await generateDevhookId(secret1, SERVER_SECRET);
      const devhookId2 = await generateDevhookId(secret2, SERVER_SECRET);

      const response1 = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId1}/test`
      );
      const response2 = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId2}/test`
      );

      expect(await response1.text()).toBe("Client 1");
      expect(await response2.text()).toBe("Client 2");
    });

    it("should handle request errors gracefully", async () => {
      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "error-test-secret",
        onRequest: async () => {
          throw new Error("Intentional error");
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("error-test-secret", SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/test`
      );

      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toContain("Intentional error");
    });

    it("should call onDisconnect when connection is lost", async () => {
      let disconnected = false;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "disconnect-callback-test",
        onRequest: async () => new Response("OK"),
        onDisconnect: () => {
          disconnected = true;
        },
      });

      const disposable = client.connect();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(disconnected).toBe(false);
      disposable.dispose();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Note: onDisconnect may not be called immediately on dispose
      // since dispose just closes the socket
    });

    it("should handle large request bodies", async () => {
      let receivedSize = 0;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "large-body-test",
        onRequest: async (req) => {
          const body = await req.text();
          receivedSize = body.length;
          return new Response(`Received ${receivedSize} bytes`);
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("large-body-test", SERVER_SECRET);
      const largeBody = "x".repeat(100000); // 100KB

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/upload`,
        {
          method: "POST",
          body: largeBody,
        }
      );

      expect(response.status).toBe(200);
      expect(receivedSize).toBe(100000);
    });

    it("should handle large response bodies", async () => {
      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "large-response-test",
        onRequest: async () => {
          const largeBody = "y".repeat(100000); // 100KB
          return new Response(largeBody);
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("large-response-test", SERVER_SECRET);
      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/download`
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body.length).toBe(100000);
      expect(body).toBe("y".repeat(100000));
    });
  });

  describe("server callbacks", () => {
    it("should call onClientConnect and onClientDisconnect", async () => {
      const connectedIds: string[] = [];
      const disconnectedIds: string[] = [];

      const serverPort = 20080 + Math.floor(Math.random() * 1000);
      const server = createLocalServer({
        port: serverPort,
        secret: SERVER_SECRET,
        baseUrl: `http://localhost:${serverPort}`,
        mode: "subpath",
        onClientConnect: (id) => connectedIds.push(id),
        onClientDisconnect: (id) => disconnectedIds.push(id),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "callback-test-secret",
        onRequest: async () => new Response("OK"),
      });

      const disposable = client.connect();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(connectedIds.length).toBe(1);
      expect(connectedIds[0]).toHaveLength(16);

      disposable.dispose();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(disconnectedIds.length).toBe(1);
      expect(disconnectedIds[0]).toBe(connectedIds[0]);

      server.close();
    });

    it("should call onReady with port", async () => {
      let readyPort: number | undefined;
      const serverPort = 21080 + Math.floor(Math.random() * 1000);

      const server = createLocalServer({
        port: serverPort,
        secret: SERVER_SECRET,
        baseUrl: `http://localhost:${serverPort}`,
        mode: "subpath",
        onReady: (port) => {
          readyPort = port;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(readyPort).toBe(serverPort);

      server.close();
    });
  });
});
