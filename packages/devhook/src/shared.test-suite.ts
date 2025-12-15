/**
 * Shared test suite that runs against any devhook server implementation.
 *
 * This file exports test functions that can be called with different server factories
 * to ensure both local and Cloudflare servers behave identically.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { DevhookClient } from "./client";
import {
  type TestServer,
  type TestServerFactory,
  getDevhookId,
  getDevhookUrl,
  getDevhookWsUrl,
  delay,
} from "./test-utils";

export interface SharedTestOptions {
  /**
   * Skip WebSocket proxying tests.
   * Useful for environments where WebSocket behavior differs (e.g., miniflare).
   */
  skipWebSocketTests?: boolean;
}

/**
 * Run the shared test suite against a server implementation.
 */
export function runSharedTests(
  serverName: string,
  serverFactory: TestServerFactory,
  serverSecret: string,
  options: SharedTestOptions = {}
) {
  const { skipWebSocketTests = false } = options;
  describe(`${serverName} server`, () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await serverFactory();
      await delay(100); // Give server time to start
    });

    afterAll(async () => {
      await server?.close();
    });

    describe("basic endpoints", () => {
      it("should respond to health check", async () => {
        const response = await fetch(`${server.url}/health`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { status: string };
        expect(body.status).toBe("ok");
      });

      it("should return 404 for unknown routes", async () => {
        const response = await fetch(`${server.url}/unknown`);
        expect(response.status).toBe(404);
      });

      it("should return 426 for non-WebSocket connect requests", async () => {
        const response = await fetch(`${server.url}/api/devhook/connect`);
        expect(response.status).toBe(426);
      });
    });

    describe("client-server integration", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should connect and receive public URL", async () => {
        let connectedUrl: string | undefined;
        let connectedId: string | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "test-client",
          onRequest: async () => new Response("OK"),
          onConnect: ({ url, id }) => {
            connectedUrl = url;
            connectedId = id;
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);

        await delay(200);

        expect(connectedUrl).toBeDefined();
        expect(connectedId).toBeDefined();
        expect(connectedId).toHaveLength(16);
        expect(connectedUrl).toContain(connectedId);
      });

      it("should proxy GET requests", async () => {
        let receivedRequest: Request | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "get-test",
          onRequest: async (req) => {
            receivedRequest = req;
            return new Response("GET response");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("get-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/api/data"));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("GET response");
        expect(receivedRequest?.method).toBe("GET");
        expect(new URL(receivedRequest!.url).pathname).toBe("/api/data");
      });

      it("should proxy POST requests with JSON body", async () => {
        let receivedBody: unknown;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "post-test",
          onRequest: async (req) => {
            receivedBody = await req.json();
            return new Response(JSON.stringify({ received: true }), {
              headers: { "content-type": "application/json" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("post-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/api/submit"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "test", value: 123 }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { received: boolean };
        expect(body.received).toBe(true);
        expect(receivedBody).toEqual({ name: "test", value: 123 });
      });

      it("should preserve query parameters", async () => {
        let receivedUrl: string | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "query-test",
          onRequest: async (req) => {
            receivedUrl = req.url;
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("query-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/search?q=test&page=1"));

        expect(receivedUrl).toBeDefined();
        const url = new URL(receivedUrl!);
        expect(url.searchParams.get("q")).toBe("test");
        expect(url.searchParams.get("page")).toBe("1");
      });

      it("should preserve request headers", async () => {
        let receivedHeaders: Record<string, string> = {};

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "headers-test",
          onRequest: async (req) => {
            req.headers.forEach((value, key) => {
              receivedHeaders[key.toLowerCase()] = value;
            });
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("headers-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: {
            "x-custom-header": "custom-value",
            "authorization": "Bearer token123",
          },
        });

        expect(receivedHeaders["x-custom-header"]).toBe("custom-value");
        expect(receivedHeaders["authorization"]).toBe("Bearer token123");
      });

      it("should return response headers from client", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "resp-headers-test",
          onRequest: async () => {
            return new Response("OK", {
              headers: {
                "x-custom-response": "response-value",
                "cache-control": "no-cache",
              },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("resp-headers-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.headers.get("x-custom-response")).toBe("response-value");
        expect(response.headers.get("cache-control")).toBe("no-cache");
      });

      it("should handle different HTTP status codes", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "status-test",
          onRequest: async (req) => {
            const url = new URL(req.url);
            const status = parseInt(url.searchParams.get("status") || "200");
            return new Response(null, { status });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("status-test", serverSecret);

        const response201 = await fetch(getDevhookUrl(server, devhookId, "/?status=201"));
        expect(response201.status).toBe(201);

        const response404 = await fetch(getDevhookUrl(server, devhookId, "/?status=404"));
        expect(response404.status).toBe(404);

        const response500 = await fetch(getDevhookUrl(server, devhookId, "/?status=500"));
        expect(response500.status).toBe(500);
      });

      it("should return 503 when no client is connected", async () => {
        const devhookId = await getDevhookId("no-client", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(503);
        const body = (await response.json()) as { error: string };
        expect(body.error).toBeDefined();
      });

      it("should handle client disconnection gracefully", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "disconnect-test",
          onRequest: async () => new Response("OK"),
        });

        const disposable = client.connect();
        await delay(200);

        const devhookId = await getDevhookId("disconnect-test", serverSecret);

        // First request should work
        const response1 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(response1.status).toBe(200);

        // Disconnect
        disposable.dispose();
        await delay(100);

        // Second request should fail
        const response2 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(response2.status).toBe(503);
      });

      it("should handle reconnection with same secret", async () => {
        const secret = "reconnect-test";

        const client1 = new DevhookClient({
          serverUrl: server.url,
          secret,
          onRequest: async () => new Response("client1"),
        });

        const disposable1 = client1.connect();
        await delay(200);

        const devhookId = await getDevhookId(secret, serverSecret);
        const response1 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(await response1.text()).toBe("client1");

        // Disconnect first client
        disposable1.dispose();
        await delay(100);

        // Connect second client with same secret
        const client2 = new DevhookClient({
          serverUrl: server.url,
          secret,
          onRequest: async () => new Response("client2"),
        });

        const disposable2 = client2.connect();
        clientConnections.push(disposable2);
        await delay(200);

        // Should get response from new client
        const response2 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(await response2.text()).toBe("client2");
      });

      it("should handle multiple concurrent clients with different secrets", async () => {
        const client1 = new DevhookClient({
          serverUrl: server.url,
          secret: "multi-1",
          onRequest: async () => new Response("response1"),
        });

        const client2 = new DevhookClient({
          serverUrl: server.url,
          secret: "multi-2",
          onRequest: async () => new Response("response2"),
        });

        const disposable1 = client1.connect();
        const disposable2 = client2.connect();
        clientConnections.push(disposable1, disposable2);
        await delay(200);

        const devhookId1 = await getDevhookId("multi-1", serverSecret);
        const devhookId2 = await getDevhookId("multi-2", serverSecret);

        const [response1, response2] = await Promise.all([
          fetch(getDevhookUrl(server, devhookId1, "/")),
          fetch(getDevhookUrl(server, devhookId2, "/")),
        ]);

        expect(await response1.text()).toBe("response1");
        expect(await response2.text()).toBe("response2");
      });

      it("should handle request errors gracefully", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "error-test",
          onRequest: async () => {
            throw new Error("Handler error");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("error-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(502);
      });
    });

    describe.skipIf(skipWebSocketTests)("websocket proxying", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should proxy WebSocket connections", async () => {
        const receivedMessages: string[] = [];
        let localWsConnected = false;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          localWsConnected = true;
          ws.on("message", (data) => {
            receivedMessages.push(data.toString());
            ws.send(`echo: ${data.toString()}`);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-test",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("ws-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        const externalMessages: string[] = [];
        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.send("hello from external");
          });

          externalWs.on("message", (data) => {
            externalMessages.push(data.toString());
            if (externalMessages.length >= 1) {
              resolve();
            }
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        expect(localWsConnected).toBe(true);
        expect(receivedMessages).toContain("hello from external");
        expect(externalMessages).toContain("echo: hello from external");

        externalWs.close();
        localWsServer.close();
      });

      it("should handle WebSocket close from external client", async () => {
        let localWsClosed = false;
        let closeCode: number | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("close", (code) => {
            localWsClosed = true;
            closeCode = code;
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-close-test",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("ws-close-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.close(1000, "Normal closure");
          });

          externalWs.on("close", () => {
            setTimeout(resolve, 100);
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        expect(localWsClosed).toBe(true);
        expect(closeCode).toBe(1000);

        localWsServer.close();
      });

      it("should handle multiple concurrent WebSocket connections to the same client", async () => {
        const localConnections: Set<number> = new Set();
        let connectionCounter = 0;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          const connId = connectionCounter++;
          localConnections.add(connId);

          ws.on("message", (data) => {
            ws.send(`conn${connId}: ${data.toString()}`);
          });

          ws.on("close", () => {
            localConnections.delete(connId);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-concurrent-test",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("ws-concurrent-test", serverSecret);

        // Create 5 concurrent WebSocket connections
        const numConnections = 5;
        const externalWsConnections: InstanceType<typeof WsClient>[] = [];
        const receivedMessages: Map<number, string[]> = new Map();

        for (let i = 0; i < numConnections; i++) {
          receivedMessages.set(i, []);
          const ws = new WsClient(getDevhookWsUrl(server, devhookId, `/ws${i}`));
          externalWsConnections.push(ws);
        }

        // Wait for all connections to open
        await Promise.all(
          externalWsConnections.map(
            (ws, i) =>
              new Promise<void>((resolve, reject) => {
                ws.on("open", resolve);
                ws.on("error", reject);
                ws.on("message", (data) => {
                  receivedMessages.get(i)!.push(data.toString());
                });
                setTimeout(() => reject(new Error(`Connection ${i} timeout`)), 5000);
              })
          )
        );

        expect(localConnections.size).toBe(numConnections);

        // Send messages from each connection
        for (let i = 0; i < numConnections; i++) {
          externalWsConnections[i]!.send(`hello from ws${i}`);
        }

        await delay(200);

        // Verify each connection received its own response
        for (let i = 0; i < numConnections; i++) {
          expect(receivedMessages.get(i)!.length).toBeGreaterThanOrEqual(1);
          expect(receivedMessages.get(i)![0]).toContain(`hello from ws${i}`);
        }

        // Close all connections
        for (const ws of externalWsConnections) {
          ws.close();
        }

        await delay(100);
        localWsServer.close();
      });

      it("should handle WebSocket connections from multiple devhook clients simultaneously", async () => {
        const { WebSocketServer, WebSocket: WsClient } = await import("ws");

        const localWsServer1 = new WebSocketServer({ port: 0 });
        const localWsPort1 = (localWsServer1.address() as { port: number }).port;
        const localWsServer2 = new WebSocketServer({ port: 0 });
        const localWsPort2 = (localWsServer2.address() as { port: number }).port;

        const messages1: string[] = [];
        const messages2: string[] = [];

        localWsServer1.on("connection", (ws) => {
          ws.on("message", (data) => {
            messages1.push(data.toString());
            ws.send(`server1: ${data.toString()}`);
          });
        });

        localWsServer2.on("connection", (ws) => {
          ws.on("message", (data) => {
            messages2.push(data.toString());
            ws.send(`server2: ${data.toString()}`);
          });
        });

        const client1 = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-multi-1",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort1}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort1}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const client2 = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-multi-2",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort2}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort2}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const disposable1 = client1.connect();
        const disposable2 = client2.connect();
        clientConnections.push(disposable1, disposable2);
        await delay(200);

        const devhookId1 = await getDevhookId("ws-multi-1", serverSecret);
        const devhookId2 = await getDevhookId("ws-multi-2", serverSecret);

        const externalWs1 = new WsClient(getDevhookWsUrl(server, devhookId1, "/ws"));
        const externalWs2 = new WsClient(getDevhookWsUrl(server, devhookId2, "/ws"));

        const received1: string[] = [];
        const received2: string[] = [];

        await Promise.all([
          new Promise<void>((resolve, reject) => {
            externalWs1.on("open", resolve);
            externalWs1.on("error", reject);
            externalWs1.on("message", (data) => received1.push(data.toString()));
            setTimeout(() => reject(new Error("Timeout ws1")), 5000);
          }),
          new Promise<void>((resolve, reject) => {
            externalWs2.on("open", resolve);
            externalWs2.on("error", reject);
            externalWs2.on("message", (data) => received2.push(data.toString()));
            setTimeout(() => reject(new Error("Timeout ws2")), 5000);
          }),
        ]);

        externalWs1.send("message to client 1");
        externalWs2.send("message to client 2");

        await delay(200);

        // Verify messages were routed correctly
        expect(messages1).toContain("message to client 1");
        expect(messages2).toContain("message to client 2");
        expect(messages1).not.toContain("message to client 2");
        expect(messages2).not.toContain("message to client 1");

        // Verify responses came from correct servers
        expect(received1.length).toBeGreaterThanOrEqual(1);
        expect(received1[0]).toContain("server1:");
        expect(received2.length).toBeGreaterThanOrEqual(1);
        expect(received2[0]).toContain("server2:");

        externalWs1.close();
        externalWs2.close();
        await delay(100);
        localWsServer1.close();
        localWsServer2.close();
      });

      it("should isolate WebSocket connections - closing one doesn't affect others", async () => {
        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => ws.send(data));
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-isolate-test",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("ws-isolate-test", serverSecret);

        const ws1 = new WsClient(getDevhookWsUrl(server, devhookId, "/a"));
        const ws2 = new WsClient(getDevhookWsUrl(server, devhookId, "/b"));
        const ws3 = new WsClient(getDevhookWsUrl(server, devhookId, "/c"));

        const received2: string[] = [];
        const received3: string[] = [];

        await Promise.all([
          new Promise<void>((resolve, reject) => {
            ws1.on("open", resolve);
            ws1.on("error", reject);
            setTimeout(() => reject(new Error("Timeout")), 5000);
          }),
          new Promise<void>((resolve, reject) => {
            ws2.on("open", resolve);
            ws2.on("error", reject);
            ws2.on("message", (data) => received2.push(data.toString()));
            setTimeout(() => reject(new Error("Timeout")), 5000);
          }),
          new Promise<void>((resolve, reject) => {
            ws3.on("open", resolve);
            ws3.on("error", reject);
            ws3.on("message", (data) => received3.push(data.toString()));
            setTimeout(() => reject(new Error("Timeout")), 5000);
          }),
        ]);

        // Close ws1
        ws1.close();
        await delay(200);

        // ws2 and ws3 should still work
        expect(ws2.readyState).toBe(WsClient.OPEN);
        expect(ws3.readyState).toBe(WsClient.OPEN);

        // Send messages on remaining connections
        ws2.send("still alive 2");
        ws3.send("still alive 3");

        await delay(200);

        expect(received2).toContain("still alive 2");
        expect(received3).toContain("still alive 3");

        ws2.close();
        ws3.close();
        await delay(100);
        localWsServer.close();
      });

      // Note: miniflare/wrangler dev can be slow with WebSocket close propagation
      // See: https://github.com/cloudflare/workers-sdk/issues/10307
      it("should close proxied WebSockets when devhook client disconnects", { timeout: 30000 }, async () => {
        let externalWsClosed = false;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => {
            ws.send(data);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-disconnect-test",
          transformUrl: (url) => {
            url.host = `localhost:${localWsPort}`;
            return url;
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const disposable = client.connect();
        // Don't add to clientConnections - we'll manually dispose
        await delay(200);

        const devhookId = await getDevhookId("ws-disconnect-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            resolve();
          });
          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout connecting")), 5000);
        });

        // Disconnect the devhook client and wait for external WS to close
        await new Promise<void>((resolve, reject) => {
          externalWs.on("close", () => {
            externalWsClosed = true;
            resolve();
          });

          disposable.dispose();

          // Longer timeout for miniflare's slow WebSocket close handling
          setTimeout(() => {
            reject(new Error("External WS did not close after devhook client disconnect"));
          }, 20000);
        });

        expect(externalWsClosed).toBe(true);

        localWsServer.close();
      });

      it("should return 503 when no client is connected for WebSocket", async () => {
        const { WebSocket: WsClient } = await import("ws");
        const devhookId = await getDevhookId("nonexistent-ws", serverSecret);

        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve) => {
          externalWs.on("error", () => {
            resolve();
          });

          externalWs.on("open", () => {
            externalWs.close();
            resolve();
          });

          setTimeout(resolve, 1000);
        });

        expect(externalWs.readyState).not.toBe(WsClient.OPEN);
      });
    });
  });
}
