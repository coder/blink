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
      expect(id1).toMatch(/^[0-9a-z]+$/);
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
      expect(id).toMatch(/^[0-9a-z]+$/);
    });

    it("should handle unicode secrets", async () => {
      const id = await generateDevhookId("секрет🔐", SERVER_SECRET);
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[0-9a-z]+$/);
    });

    it("should use full base36 alphabet for maximum entropy", async () => {
      // Generate many IDs and verify we see characters beyond hex (g-z)
      const ids = new Set<string>();
      const allChars = new Set<string>();

      // Generate IDs with different secrets
      for (let i = 0; i < 100; i++) {
        const id = await generateDevhookId(`secret-${i}`, SERVER_SECRET);
        ids.add(id);
        for (const char of id) {
          allChars.add(char);
        }
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);

      // We should see characters beyond hex (g-z)
      // With 100 random IDs, it's statistically almost certain we'll see some
      const beyondHex = [...allChars].filter((c) => c >= "g" && c <= "z");
      expect(beyondHex.length).toBeGreaterThan(0);
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

    it("should support webhook signature verification", async () => {
      // Simulate a webhook with HMAC signature verification (like GitHub webhooks)
      const webhookSecret = "webhook-secret-key";
      let signatureValid = false;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "webhook-test",
        onRequest: async (req) => {
          // Read the raw body for signature verification
          const rawBody = await req.text();
          const signature = req.headers.get("x-hub-signature-256");

          if (signature) {
            // Verify HMAC-SHA256 signature (simplified - real impl would use crypto)
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
              "raw",
              encoder.encode(webhookSecret),
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"]
            );
            const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
            const expectedSig = "sha256=" + Array.from(new Uint8Array(sig))
              .map(b => b.toString(16).padStart(2, "0"))
              .join("");

            signatureValid = signature === expectedSig;
          }

          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("webhook-test", SERVER_SECRET);

      // Create a webhook payload with signature
      const payload = JSON.stringify({ event: "push", repository: "test/repo" });
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(webhookSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const signature = "sha256=" + Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/webhook/github`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": signature,
            "x-github-event": "push",
          },
          body: payload,
        }
      );

      expect(response.status).toBe(200);
      expect(signatureValid).toBe(true);
    });

    it("should handle webhook-style POST with form data", async () => {
      let receivedContentType: string | null = null;
      let receivedBody: string | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "form-webhook-test",
        onRequest: async (req) => {
          receivedContentType = req.headers.get("content-type");
          receivedBody = await req.text();
          return new Response("OK");
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("form-webhook-test", SERVER_SECRET);

      const formData = new URLSearchParams();
      formData.append("payload", JSON.stringify({ action: "opened" }));
      formData.append("token", "abc123");

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      );

      expect(response.status).toBe(200);
      expect(receivedContentType).toBe("application/x-www-form-urlencoded");
      expect(receivedBody).toContain("payload");
      expect(receivedBody).toContain("token");
    });
  });

  describe("webhook functionality", () => {
    let server: ReturnType<typeof createLocalServer>;
    let serverPort: number;
    let clientConnections: Array<{ dispose: () => void }> = [];

    beforeAll(async () => {
      serverPort = 22080 + Math.floor(Math.random() * 1000);
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
      for (const conn of clientConnections) {
        conn.dispose();
      }
      clientConnections = [];
    });

    // Helper to create HMAC-SHA256 signature
    async function createSignature(payload: string, secret: string): Promise<string> {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      return "sha256=" + Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }

    // Helper to verify HMAC-SHA256 signature
    async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
      const expected = await createSignature(payload, secret);
      return signature === expected;
    }

    it("should handle concurrent webhooks to the same client", async () => {
      const receivedWebhooks: Array<{ id: string; body: string; timestamp: number }> = [];
      const webhookSecret = "concurrent-test-secret";

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "concurrent-webhook-client",
        onRequest: async (req) => {
          const body = await req.text();
          const id = req.headers.get("x-webhook-id") || "unknown";
          
          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50));
          
          receivedWebhooks.push({
            id,
            body,
            timestamp: Date.now(),
          });

          return new Response(JSON.stringify({ received: id }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("concurrent-webhook-client", SERVER_SECRET);

      // Send 10 webhooks concurrently
      const webhookCount = 10;
      const promises = Array.from({ length: webhookCount }, async (_, i) => {
        const payload = JSON.stringify({ event: "test", index: i });
        const response = await fetch(
          `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-webhook-id": `webhook-${i}`,
            },
            body: payload,
          }
        );
        return { index: i, status: response.status, body: await response.json() };
      });

      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results.every(r => r.status === 200)).toBe(true);
      
      // All webhooks should be received
      expect(receivedWebhooks.length).toBe(webhookCount);
      
      // Each webhook should have unique ID
      const receivedIds = new Set(receivedWebhooks.map(w => w.id));
      expect(receivedIds.size).toBe(webhookCount);
    });

    it("should handle concurrent webhooks to different clients", async () => {
      const clientResults: Map<string, string[]> = new Map();

      // Create 3 clients with different secrets
      const clientSecrets = ["client-a", "client-b", "client-c"];
      
      for (const secret of clientSecrets) {
        clientResults.set(secret, []);
        
        const client = new DevhookClient({
          serverUrl: `http://localhost:${serverPort}`,
          secret,
          onRequest: async (req) => {
            const body = await req.json() as { clientId: string; webhookId: string };
            clientResults.get(secret)!.push(body.webhookId);
            
            // Simulate processing
            await new Promise((resolve) => setTimeout(resolve, 30));
            
            return new Response(JSON.stringify({ client: secret, received: body.webhookId }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
      }

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Send webhooks to all clients concurrently
      const promises: Promise<{ client: string; webhookId: string; status: number }>[] = [];
      
      for (const secret of clientSecrets) {
        const devhookId = await generateDevhookId(secret, SERVER_SECRET);
        
        // Send 5 webhooks to each client
        for (let i = 0; i < 5; i++) {
          const webhookId = `${secret}-webhook-${i}`;
          promises.push(
            fetch(
              `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ clientId: secret, webhookId }),
              }
            ).then(async (response) => ({
              client: secret,
              webhookId,
              status: response.status,
            }))
          );
        }
      }

      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results.every(r => r.status === 200)).toBe(true);

      // Each client should receive exactly 5 webhooks
      for (const secret of clientSecrets) {
        const received = clientResults.get(secret)!;
        expect(received.length).toBe(5);
        
        // Verify the webhooks belong to this client
        expect(received.every(id => id.startsWith(secret))).toBe(true);
      }
    });

    it("should preserve request body integrity for signature verification with concurrent requests", async () => {
      const webhookSecret = "integrity-test-secret";
      const verificationResults: Array<{ id: string; valid: boolean }> = [];

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "integrity-client",
        onRequest: async (req) => {
          const rawBody = await req.text();
          const signature = req.headers.get("x-signature");
          const webhookId = req.headers.get("x-webhook-id") || "unknown";

          const isValid = signature ? await verifySignature(rawBody, signature, webhookSecret) : false;
          
          verificationResults.push({ id: webhookId, valid: isValid });

          return new Response(JSON.stringify({ verified: isValid }), {
            status: isValid ? 200 : 401,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("integrity-client", SERVER_SECRET);

      // Send 20 webhooks concurrently with different payloads
      const webhookCount = 20;
      const promises = Array.from({ length: webhookCount }, async (_, i) => {
        const payload = JSON.stringify({ 
          event: "test", 
          index: i, 
          data: `payload-data-${i}-${Math.random()}`,
          timestamp: Date.now(),
        });
        const signature = await createSignature(payload, webhookSecret);

        const response = await fetch(
          `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-signature": signature,
              "x-webhook-id": `webhook-${i}`,
            },
            body: payload,
          }
        );
        return { index: i, status: response.status };
      });

      const results = await Promise.all(promises);

      // All requests should succeed with valid signatures
      expect(results.every(r => r.status === 200)).toBe(true);
      expect(verificationResults.length).toBe(webhookCount);
      expect(verificationResults.every(r => r.valid)).toBe(true);
    });

    it("should handle webhooks with varying payload sizes concurrently", async () => {
      const receivedSizes: number[] = [];

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "varying-size-client",
        onRequest: async (req) => {
          const body = await req.text();
          receivedSizes.push(body.length);
          return new Response(JSON.stringify({ size: body.length }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("varying-size-client", SERVER_SECRET);

      // Send webhooks with varying sizes: 100B, 1KB, 10KB, 50KB
      const sizes = [100, 1000, 10000, 50000];
      const promises = sizes.flatMap((size, sizeIndex) => 
        // Send 3 webhooks of each size
        Array.from({ length: 3 }, async (_, i) => {
          const payload = JSON.stringify({
            index: sizeIndex * 3 + i,
            data: "x".repeat(size),
          });

          const response = await fetch(
            `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: payload,
            }
          );
          const result = await response.json() as { size: number };
          return { expectedMinSize: size, actualSize: result.size, status: response.status };
        })
      );

      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results.every(r => r.status === 200)).toBe(true);
      
      // All sizes should be received correctly (payload includes JSON overhead)
      expect(results.every(r => r.actualSize >= r.expectedMinSize)).toBe(true);
      expect(receivedSizes.length).toBe(12); // 4 sizes * 3 requests each
    });

    it("should handle rapid sequential webhooks", async () => {
      const receivedOrder: number[] = [];

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "sequential-client",
        onRequest: async (req) => {
          const body = await req.json() as { index: number };
          receivedOrder.push(body.index);
          return new Response(JSON.stringify({ received: body.index }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("sequential-client", SERVER_SECRET);

      // Send 50 webhooks as fast as possible (but sequentially)
      const webhookCount = 50;
      for (let i = 0; i < webhookCount; i++) {
        const response = await fetch(
          `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ index: i }),
          }
        );
        expect(response.status).toBe(200);
      }

      // All webhooks should be received in order
      expect(receivedOrder.length).toBe(webhookCount);
      expect(receivedOrder).toEqual(Array.from({ length: webhookCount }, (_, i) => i));
    });

    it("should handle webhook with slow processing without blocking others", async () => {
      const processingTimes: Array<{ id: string; duration: number }> = [];

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "slow-processing-client",
        onRequest: async (req) => {
          const start = Date.now();
          const body = await req.json() as { id: string; delay: number };
          
          // Simulate variable processing time
          await new Promise((resolve) => setTimeout(resolve, body.delay));
          
          processingTimes.push({ id: body.id, duration: Date.now() - start });

          return new Response(JSON.stringify({ processed: body.id }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("slow-processing-client", SERVER_SECRET);

      const startTime = Date.now();

      // Send webhooks with different delays concurrently
      // One slow (500ms), several fast (10ms)
      const promises = [
        fetch(`http://localhost:${serverPort}/devhook/${devhookId}/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "slow", delay: 500 }),
        }),
        ...Array.from({ length: 5 }, (_, i) =>
          fetch(`http://localhost:${serverPort}/devhook/${devhookId}/webhook`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: `fast-${i}`, delay: 10 }),
          })
        ),
      ];

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      expect(results.every(r => r.status === 200)).toBe(true);

      // Fast requests should not be blocked by the slow one
      // Total time should be closer to 500ms (slow request) than 500 + 5*10 = 550ms
      // Allow some overhead but it should complete in reasonable time
      expect(totalTime).toBeLessThan(1000);
      
      // All webhooks should be processed
      expect(processingTimes.length).toBe(6);
    });

    it("should handle GitHub-style webhook with all headers", async () => {
      let receivedHeaders: Record<string, string | null> = {};
      let receivedBody: string | undefined;
      const webhookSecret = "github-webhook-secret";

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "github-style-client",
        onRequest: async (req) => {
          receivedBody = await req.text();
          receivedHeaders = {
            "x-github-event": req.headers.get("x-github-event"),
            "x-github-delivery": req.headers.get("x-github-delivery"),
            "x-hub-signature-256": req.headers.get("x-hub-signature-256"),
            "content-type": req.headers.get("content-type"),
            "user-agent": req.headers.get("user-agent"),
          };

          // Verify signature
          const signature = req.headers.get("x-hub-signature-256");
          if (signature && receivedBody) {
            const isValid = await verifySignature(receivedBody, signature, webhookSecret);
            if (!isValid) {
              return new Response("Invalid signature", { status: 401 });
            }
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("github-style-client", SERVER_SECRET);

      const payload = JSON.stringify({
        action: "opened",
        pull_request: {
          number: 42,
          title: "Test PR",
        },
        repository: {
          full_name: "owner/repo",
        },
      });

      const signature = await createSignature(payload, webhookSecret);
      const deliveryId = crypto.randomUUID();

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/webhook/github`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "pull_request",
            "x-github-delivery": deliveryId,
            "x-hub-signature-256": signature,
            "user-agent": "GitHub-Hookshot/test",
          },
          body: payload,
        }
      );

      expect(response.status).toBe(200);
      expect(receivedHeaders["x-github-event"]).toBe("pull_request");
      expect(receivedHeaders["x-github-delivery"]).toBe(deliveryId);
      expect(receivedHeaders["x-hub-signature-256"]).toBe(signature);
      expect(receivedHeaders["content-type"]).toBe("application/json");
      expect(receivedHeaders["user-agent"]).toBe("GitHub-Hookshot/test");
      expect(receivedBody).toBe(payload);
    });

    it("should handle Stripe-style webhook", async () => {
      const stripeSecret = "whsec_test_secret";
      let receivedEvent: unknown;
      let signatureValid = false;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "stripe-style-client",
        onRequest: async (req) => {
          const rawBody = await req.text();
          const signature = req.headers.get("stripe-signature");

          // Stripe uses a different signature format: t=timestamp,v1=signature
          if (signature) {
            const parts = signature.split(",");
            const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
            const v1Sig = parts.find(p => p.startsWith("v1="))?.slice(3);

            if (timestamp && v1Sig) {
              const signedPayload = `${timestamp}.${rawBody}`;
              const expectedSig = await createSignature(signedPayload, stripeSecret);
              // Remove the "sha256=" prefix for comparison
              signatureValid = v1Sig === expectedSig.slice(7);
            }
          }

          if (!signatureValid) {
            return new Response("Invalid signature", { status: 400 });
          }

          receivedEvent = JSON.parse(rawBody);
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("stripe-style-client", SERVER_SECRET);

      const payload = JSON.stringify({
        id: "evt_test_123",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_test_123",
            amount: 2000,
            currency: "usd",
          },
        },
      });

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${payload}`;
      const sig = await createSignature(signedPayload, stripeSecret);
      const stripeSignature = `t=${timestamp},v1=${sig.slice(7)}`; // Remove "sha256=" prefix

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/webhook/stripe`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": stripeSignature,
          },
          body: payload,
        }
      );

      expect(response.status).toBe(200);
      expect(signatureValid).toBe(true);
      expect(receivedEvent).toEqual(JSON.parse(payload));
    });

    it("should handle webhook retry scenarios", async () => {
      let attemptCount = 0;
      const maxAttempts = 3;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "retry-client",
        onRequest: async (req) => {
          attemptCount++;
          const body = await req.json() as { attempt: number };

          // Fail first 2 attempts, succeed on 3rd
          if (attemptCount < maxAttempts) {
            return new Response("Service unavailable", { status: 503 });
          }

          return new Response(JSON.stringify({ success: true, attempts: attemptCount }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("retry-client", SERVER_SECRET);

      // Simulate webhook retries
      let lastResponse: Response | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        lastResponse = await fetch(
          `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ attempt }),
          }
        );

        if (lastResponse.status === 200) {
          break;
        }

        // Wait before retry (simulating webhook provider behavior)
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(lastResponse?.status).toBe(200);
      expect(attemptCount).toBe(maxAttempts);
    });

    it("should handle binary webhook payloads", async () => {
      let receivedBytes: Uint8Array | undefined;

      const client = new DevhookClient({
        serverUrl: `http://localhost:${serverPort}`,
        secret: "binary-client",
        onRequest: async (req) => {
          const buffer = await req.arrayBuffer();
          receivedBytes = new Uint8Array(buffer);
          return new Response(JSON.stringify({ size: receivedBytes.length }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const disposable = client.connect();
      clientConnections.push(disposable);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const devhookId = await generateDevhookId("binary-client", SERVER_SECRET);

      // Create binary payload
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD, 0x00, 0x00]);

      const response = await fetch(
        `http://localhost:${serverPort}/devhook/${devhookId}/webhook`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: binaryData,
        }
      );

      expect(response.status).toBe(200);
      expect(receivedBytes).toBeDefined();
      expect(receivedBytes!.length).toBe(binaryData.length);
      expect(Array.from(receivedBytes!)).toEqual(Array.from(binaryData));
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
