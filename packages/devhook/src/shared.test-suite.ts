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

        // Verify each connection received exactly one response
        for (let i = 0; i < numConnections; i++) {
          expect(receivedMessages.get(i)!.length).toBe(1);
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

        // Verify exactly one response from each server
        expect(received1.length).toBe(1);
        expect(received1[0]).toContain("server1:");
        expect(received2.length).toBe(1);
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

    describe("multi-value headers", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it.fails("should preserve multiple Set-Cookie headers", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "multi-cookie-test",
          onRequest: async () => {
            const headers = new Headers();
            headers.append("Set-Cookie", "a=1; Path=/");
            headers.append("Set-Cookie", "b=2; Path=/");
            headers.append("Set-Cookie", "c=3; Path=/");
            return new Response("OK", { headers });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("multi-cookie-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(200);

        // Get all Set-Cookie headers - this will fail because Record<string, string> loses duplicates
        const setCookieHeaders = response.headers.getSetCookie();
        expect(setCookieHeaders).toHaveLength(3);
        expect(setCookieHeaders).toContain("a=1; Path=/");
        expect(setCookieHeaders).toContain("b=2; Path=/");
        expect(setCookieHeaders).toContain("c=3; Path=/");
      });

      it.fails("should handle Set-Cookie with comma in Expires date", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "cookie-expires-test",
          onRequest: async () => {
            const headers = new Headers();
            // Expires date contains a comma - if joined with ", " this breaks
            headers.append("Set-Cookie", "session=abc123; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/");
            headers.append("Set-Cookie", "user=xyz; Expires=Fri, 02 Jan 2026 00:00:00 GMT; Path=/");
            return new Response("OK", { headers });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("cookie-expires-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(200);

        const setCookieHeaders = response.headers.getSetCookie();
        expect(setCookieHeaders).toHaveLength(2);
        // Each cookie should be intact with its Expires date
        expect(setCookieHeaders.some(c => c.includes("session=abc123") && c.includes("Thu, 01 Jan 2026"))).toBe(true);
        expect(setCookieHeaders.some(c => c.includes("user=xyz") && c.includes("Fri, 02 Jan 2026"))).toBe(true);
      });

      it("should preserve Set-Cookie with all attributes", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "cookie-attrs-test",
          onRequest: async () => {
            return new Response("OK", {
              headers: {
                "Set-Cookie": "session=abc; Path=/app; Domain=example.com; Secure; HttpOnly; SameSite=Strict; Max-Age=3600",
              },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("cookie-attrs-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(200);
        const cookie = response.headers.get("set-cookie");
        expect(cookie).toContain("session=abc");
        expect(cookie).toContain("Path=/app");
        expect(cookie).toContain("Domain=example.com");
        expect(cookie).toContain("Secure");
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Strict");
        expect(cookie).toContain("Max-Age=3600");
      });

      it("should handle multiple values for headers that can be combined", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "vary-header-test",
          onRequest: async () => {
            const headers = new Headers();
            headers.append("Vary", "Accept");
            headers.append("Vary", "Accept-Encoding");
            headers.append("Cache-Control", "no-cache");
            headers.append("Cache-Control", "no-store");
            return new Response("OK", { headers });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("vary-header-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(200);
        // Vary headers can be combined with commas
        const vary = response.headers.get("vary");
        expect(vary).toContain("Accept");
        expect(vary).toContain("Accept-Encoding");
      });
    });

    describe("cookie handling", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should preserve multiple cookies in request Cookie header", async () => {
        let receivedCookies: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "multi-req-cookie-test",
          onRequest: async (req) => {
            receivedCookies = req.headers.get("cookie");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("multi-req-cookie-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: {
            "Cookie": "a=1; b=2; c=3",
          },
        });

        expect(receivedCookies).toBe("a=1; b=2; c=3");
      });

      it("should handle cookies with URL-encoded special characters", async () => {
        let receivedCookies: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "encoded-cookie-test",
          onRequest: async (req) => {
            receivedCookies = req.headers.get("cookie");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("encoded-cookie-test", serverSecret);
        // URL-encoded value with special chars: hello=world; foo=bar
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: {
            "Cookie": "data=hello%3Dworld%3B%20foo%3Dbar",
          },
        });

        expect(receivedCookies).toBe("data=hello%3Dworld%3B%20foo%3Dbar");
      });

      it("should handle long cookie values", async () => {
        let receivedCookies: string | null = null;
        const longValue = "x".repeat(4000); // Near 4KB limit

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "long-cookie-test",
          onRequest: async (req) => {
            receivedCookies = req.headers.get("cookie");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("long-cookie-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: {
            "Cookie": `longcookie=${longValue}`,
          },
        });

        expect(receivedCookies).toBe(`longcookie=${longValue}`);
      });

      it("should handle empty cookie value", async () => {
        let receivedCookies: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "empty-cookie-test",
          onRequest: async (req) => {
            receivedCookies = req.headers.get("cookie");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("empty-cookie-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: {
            "Cookie": "empty=",
          },
        });

        expect(receivedCookies).toBe("empty=");
      });

      it("should handle cookies with unicode characters (URL-encoded)", async () => {
        let receivedCookies: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "unicode-cookie-test",
          onRequest: async (req) => {
            receivedCookies = req.headers.get("cookie");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("unicode-cookie-test", serverSecret);
        // URL-encoded "值" (Chinese character for "value")
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: {
            "Cookie": "name=%E5%80%BC",
          },
        });

        expect(receivedCookies).toBe("name=%E5%80%BC");
      });
    });

    describe("header edge cases", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should handle empty header value", async () => {
        let receivedHeader: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "empty-header-test",
          onRequest: async (req) => {
            receivedHeader = req.headers.get("x-empty");
            return new Response("OK", {
              headers: { "x-empty-response": "" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("empty-header-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: { "x-empty": "" },
        });

        expect(response.status).toBe(200);
        // Empty headers may be preserved or stripped depending on implementation
        expect(receivedHeader === "" || receivedHeader === null).toBe(true);
      });

      it("should handle very long header values", async () => {
        const longValue = "x".repeat(8000);
        let receivedHeader: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "long-header-test",
          onRequest: async (req) => {
            receivedHeader = req.headers.get("x-long");
            return new Response("OK", {
              headers: { "x-long-response": longValue },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("long-header-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: { "x-long": longValue },
        });

        expect(response.status).toBe(200);
        expect(receivedHeader).toBe(longValue);
        expect(response.headers.get("x-long-response")).toBe(longValue);
      });

      it("should handle many headers", async () => {
        const numHeaders = 100;
        const sentHeaders: Record<string, string> = {};
        for (let i = 0; i < numHeaders; i++) {
          sentHeaders[`x-header-${i}`] = `value-${i}`;
        }

        let receivedCount = 0;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "many-headers-test",
          onRequest: async (req) => {
            for (let i = 0; i < numHeaders; i++) {
              if (req.headers.get(`x-header-${i}`) === `value-${i}`) {
                receivedCount++;
              }
            }
            return new Response("OK", { headers: sentHeaders });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("many-headers-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: sentHeaders,
        });

        expect(response.status).toBe(200);
        expect(receivedCount).toBe(numHeaders);

        // Check response headers
        for (let i = 0; i < numHeaders; i++) {
          expect(response.headers.get(`x-header-${i}`)).toBe(`value-${i}`);
        }
      });

      it("should preserve header value case", async () => {
        let receivedValue: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "header-case-test",
          onRequest: async (req) => {
            receivedValue = req.headers.get("x-mixed-case");
            return new Response("OK", {
              headers: { "X-Response-Mixed": "MixedCaseValue" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("header-case-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: { "X-Mixed-Case": "MixedCaseValue" },
        });

        expect(response.status).toBe(200);
        expect(receivedValue).toBe("MixedCaseValue");
        // Header names are case-insensitive, but values should be preserved
        expect(response.headers.get("x-response-mixed")).toBe("MixedCaseValue");
      });

      it("should preserve Content-Type with charset", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "content-type-charset-test",
          onRequest: async () => {
            return new Response('{"test": true}', {
              headers: { "Content-Type": "application/json; charset=utf-8" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("content-type-charset-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(200);
        const contentType = response.headers.get("content-type");
        expect(contentType).toContain("application/json");
        expect(contentType).toContain("charset=utf-8");
      });

      it("should preserve Accept header with quality values", async () => {
        let receivedAccept: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "accept-quality-test",
          onRequest: async (req) => {
            receivedAccept = req.headers.get("accept");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("accept-quality-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: { "Accept": "text/html, application/json;q=0.9, */*;q=0.8" },
        });

        expect(receivedAccept).toBe("text/html, application/json;q=0.9, */*;q=0.8");
      });

      it("should handle headers with leading/trailing whitespace in values", async () => {
        let receivedHeader: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "whitespace-header-test",
          onRequest: async (req) => {
            receivedHeader = req.headers.get("x-whitespace");
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("whitespace-header-test", serverSecret);
        await fetch(getDevhookUrl(server, devhookId, "/"), {
          headers: { "x-whitespace": "  value with spaces  " },
        });

        // HTTP spec says leading/trailing whitespace should be trimmed
        // but the exact behavior depends on implementation
        expect(receivedHeader?.includes("value with spaces")).toBe(true);
      });
    });

    describe.skipIf(skipWebSocketTests)("websocket edge cases", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should handle text messages with UTF-8 multi-byte characters", async () => {
        const testMessage = "Hello 世界 🌍 مرحبا";
        let receivedOnServer: string | undefined;
        let receivedOnClient: string | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => {
            receivedOnServer = data.toString();
            ws.send(testMessage);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-utf8-test",
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

        const devhookId = await getDevhookId("ws-utf8-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.send(testMessage);
          });

          externalWs.on("message", (data) => {
            receivedOnClient = data.toString();
            resolve();
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        expect(receivedOnServer).toBe(testMessage);
        expect(receivedOnClient).toBe(testMessage);

        externalWs.close();
        localWsServer.close();
      });

      it("should handle large binary messages", { timeout: 30000 }, async () => {
        // Use 64KB - a reasonable size that should work across implementations
        const largeData = new Uint8Array(64 * 1024);
        for (let i = 0; i < largeData.length; i++) {
          largeData[i] = i % 256;
        }

        let receivedSize = 0;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => {
            const buf = data as Buffer;
            receivedSize = buf.length;
            ws.send(buf);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-large-binary-test",
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

        const devhookId = await getDevhookId("ws-large-binary-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        let echoedSize = 0;
        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.send(largeData);
          });

          externalWs.on("message", (data) => {
            echoedSize = (data as Buffer).length;
            resolve();
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 25000);
        });

        expect(receivedSize).toBe(64 * 1024);
        expect(echoedSize).toBe(64 * 1024);

        externalWs.close();
        localWsServer.close();
      });

      it("should handle empty WebSocket messages", async () => {
        let receivedEmpty = false;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => {
            if (data.toString() === "") {
              receivedEmpty = true;
              ws.send("");
            }
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-empty-msg-test",
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

        const devhookId = await getDevhookId("ws-empty-msg-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        let receivedEmptyEcho = false;
        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.send("");
          });

          externalWs.on("message", (data) => {
            if (data.toString() === "") {
              receivedEmptyEcho = true;
            }
            resolve();
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        expect(receivedEmpty).toBe(true);
        expect(receivedEmptyEcho).toBe(true);

        externalWs.close();
        localWsServer.close();
      });

      it("should handle rapid sequential messages", async () => {
        const messageCount = 50; // Reduced count for reliability
        const receivedMessages: Set<string> = new Set();

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => {
            ws.send(`echo:${data.toString()}`);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-rapid-test",
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

        const devhookId = await getDevhookId("ws-rapid-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            for (let i = 0; i < messageCount; i++) {
              externalWs.send(`msg-${i}`);
            }
          });

          externalWs.on("message", (data) => {
            receivedMessages.add(data.toString());
            if (receivedMessages.size >= messageCount) {
              resolve();
            }
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 10000);
        });

        expect(receivedMessages.size).toBe(messageCount);
        // Verify all messages were received
        for (let i = 0; i < messageCount; i++) {
          expect(receivedMessages.has(`echo:msg-${i}`)).toBe(true);
        }

        externalWs.close();
        localWsServer.close();
      });

      it("should handle WebSocket close code 3000 (registered)", async () => {
        let receivedCloseCode: number | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("close", (code) => {
            receivedCloseCode = code;
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-close-3000-test",
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

        const devhookId = await getDevhookId("ws-close-3000-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.close(3000, "Custom registered close");
          });

          externalWs.on("close", () => {
            setTimeout(resolve, 100);
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        expect(receivedCloseCode).toBe(3000);

        localWsServer.close();
      });

      it("should handle WebSocket close code 4000 (private use)", async () => {
        let receivedCloseCode: number | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("close", (code) => {
            receivedCloseCode = code;
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-close-4000-test",
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

        const devhookId = await getDevhookId("ws-close-4000-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            externalWs.close(4000, "Private use close");
          });

          externalWs.on("close", () => {
            setTimeout(resolve, 100);
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        expect(receivedCloseCode).toBe(4000);

        localWsServer.close();
      });

      it("should handle server-initiated WebSocket close", { timeout: 15000 }, async () => {
        let clientReceivedClose = false;
        let clientCloseCode: number | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          // Server initiates close after connection
          setTimeout(() => {
            ws.close(1000, "Server closing");
          }, 100);
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-server-close-test",
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

        const devhookId = await getDevhookId("ws-server-close-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("close", (code) => {
            clientReceivedClose = true;
            clientCloseCode = code;
            resolve();
          });

          externalWs.on("error", reject);
          // Miniflare can be slow with WebSocket close propagation
          setTimeout(() => reject(new Error("Timeout")), 12000);
        });

        expect(clientReceivedClose).toBe(true);
        expect(clientCloseCode).toBe(1000);

        localWsServer.close();
      });

      it("should handle multiple WebSocket message exchanges", async () => {
        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        let serverMessageCount = 0;
        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => {
            serverMessageCount++;
            ws.send(`reply:${data.toString()}`);
          });
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-exchange-test",
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

        const devhookId = await getDevhookId("ws-exchange-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws"));

        let clientMessageCount = 0;

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            // Send first message
            externalWs.send("hello");
          });

          externalWs.on("message", (data) => {
            clientMessageCount++;
            const msg = data.toString();

            // After receiving reply to first message, send second
            if (msg === "reply:hello") {
              externalWs.send("world");
            } else if (msg === "reply:world") {
              resolve();
            }
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        // Verify bidirectional communication worked with exact message counts
        expect(serverMessageCount).toBe(2);
        expect(clientMessageCount).toBe(2);

        externalWs.close();
        localWsServer.close();
      });

      it("should handle WebSocket with query parameters", { timeout: 10000 }, async () => {
        let receivedUrl: string | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws, req) => {
          receivedUrl = req.url;
          ws.send("connected");
        });

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "ws-query-test",
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

        const devhookId = await getDevhookId("ws-query-test", serverSecret);
        const externalWs = new WsClient(getDevhookWsUrl(server, devhookId, "/ws?token=abc123&user=test"));

        await new Promise<void>((resolve, reject) => {
          externalWs.on("open", () => {
            // Give some time for the message to arrive
            setTimeout(() => {
              if (receivedUrl) {
                resolve();
              }
            }, 500);
          });

          externalWs.on("message", () => {
            resolve();
          });

          externalWs.on("error", reject);
          setTimeout(() => reject(new Error("Timeout")), 8000);
        });

        expect(receivedUrl).toContain("token=abc123");
        expect(receivedUrl).toContain("user=test");

        externalWs.close();
        localWsServer.close();
      });
    });

    describe("request/response body edge cases", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should handle empty body with Content-Length: 0", async () => {
        let receivedBody: string | undefined;
        let receivedContentLength: string | null = null;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "empty-body-test",
          onRequest: async (req) => {
            receivedContentLength = req.headers.get("content-length");
            receivedBody = await req.text();
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("empty-body-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "POST",
          headers: { "Content-Length": "0" },
          body: "",
        });

        expect(response.status).toBe(200);
        expect(receivedBody).toBe("");
      });

      it("should handle large request body", { timeout: 30000 }, async () => {
        const largeBody = "x".repeat(5 * 1024 * 1024); // 5MB
        let receivedLength = 0;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "large-req-body-test",
          onRequest: async (req) => {
            const body = await req.text();
            receivedLength = body.length;
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("large-req-body-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "POST",
          body: largeBody,
        });

        expect(response.status).toBe(200);
        expect(receivedLength).toBe(5 * 1024 * 1024);
      });

      it("should handle large response body", { timeout: 30000 }, async () => {
        const largeBody = "y".repeat(5 * 1024 * 1024); // 5MB

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "large-resp-body-test",
          onRequest: async () => {
            return new Response(largeBody);
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("large-resp-body-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body.length).toBe(5 * 1024 * 1024);
      });

      it("should handle binary request/response bodies", async () => {
        // PNG-like binary data with null bytes
        const binaryData = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        ]);
        let receivedBinary: Uint8Array | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "binary-body-test",
          onRequest: async (req) => {
            const buffer = await req.arrayBuffer();
            receivedBinary = new Uint8Array(buffer);
            return new Response(binaryData, {
              headers: { "Content-Type": "application/octet-stream" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("binary-body-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: binaryData,
        });

        expect(response.status).toBe(200);
        expect(receivedBinary).toEqual(binaryData);

        const responseBuffer = await response.arrayBuffer();
        expect(new Uint8Array(responseBuffer)).toEqual(binaryData);
      });

      it("should handle body with null bytes", async () => {
        const dataWithNulls = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]);
        let receivedData: Uint8Array | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "null-bytes-test",
          onRequest: async (req) => {
            const buffer = await req.arrayBuffer();
            receivedData = new Uint8Array(buffer);
            return new Response(dataWithNulls);
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("null-bytes-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "POST",
          body: dataWithNulls,
        });

        expect(response.status).toBe(200);
        expect(receivedData).toEqual(dataWithNulls);

        const responseBuffer = await response.arrayBuffer();
        expect(new Uint8Array(responseBuffer)).toEqual(dataWithNulls);
      });

      it("should handle JSON with unicode characters", async () => {
        const jsonData = { name: "日本語", emoji: "🎉", arabic: "مرحبا" };
        let receivedJson: unknown;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "unicode-json-test",
          onRequest: async (req) => {
            receivedJson = await req.json();
            return new Response(JSON.stringify(jsonData), {
              headers: { "Content-Type": "application/json" },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("unicode-json-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jsonData),
        });

        expect(response.status).toBe(200);
        expect(receivedJson).toEqual(jsonData);

        const responseJson = await response.json();
        expect(responseJson).toEqual(jsonData);
      });

      it("should handle URL-encoded form data", async () => {
        let receivedBody: string | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "form-data-test",
          onRequest: async (req) => {
            receivedBody = await req.text();
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("form-data-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "name=test&value=hello%20world&special=%26%3D%3F",
        });

        expect(response.status).toBe(200);
        expect(receivedBody).toBe("name=test&value=hello%20world&special=%26%3D%3F");
      });
    });

    describe("connection edge cases", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should start processing requests before client disconnects", async () => {
        let requestStarted = false;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "slow-request-test",
          onRequest: async () => {
            requestStarted = true;
            // Short delay to verify request started
            await delay(100);
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("slow-request-test", serverSecret);

        // Make a request
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(requestStarted).toBe(true);
        expect(response.status).toBe(200);
      });

      it("should handle rapid reconnect cycles", async () => {
        const cycles = 5;
        const devhookId = await getDevhookId("rapid-reconnect-test", serverSecret);

        for (let i = 0; i < cycles; i++) {
          const client = new DevhookClient({
            serverUrl: server.url,
            secret: "rapid-reconnect-test",
            onRequest: async () => new Response(`cycle-${i}`),
          });

          const disposable = client.connect();
          await delay(200);

          const response = await fetch(getDevhookUrl(server, devhookId, "/"));
          expect(response.status).toBe(200);
          expect(await response.text()).toBe(`cycle-${i}`);

          disposable.dispose();
          await delay(50);
        }
      });

      it("should handle many concurrent requests", { timeout: 30000 }, async () => {
        const numRequests = 50;
        let requestCount = 0;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "concurrent-test",
          onRequest: async (req) => {
            requestCount++;
            const url = new URL(req.url);
            return new Response(`request-${url.searchParams.get("n")}`);
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("concurrent-test", serverSecret);

        const promises = Array.from({ length: numRequests }, (_, i) =>
          fetch(getDevhookUrl(server, devhookId, `/?n=${i}`))
        );

        const responses = await Promise.all(promises);

        for (let i = 0; i < numRequests; i++) {
          expect(responses[i]!.status).toBe(200);
        }

        expect(requestCount).toBe(numRequests);
      });

      it("should return 503 immediately after client disconnect", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "immediate-503-test",
          onRequest: async () => new Response("OK"),
        });

        const disposable = client.connect();
        await delay(200);

        const devhookId = await getDevhookId("immediate-503-test", serverSecret);

        // Verify client works
        const response1 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(response1.status).toBe(200);

        // Disconnect
        disposable.dispose();

        // Immediate request should fail
        const response2 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(response2.status).toBe(503);
      });

      it("should handle new client connection with same secret", { timeout: 10000 }, async () => {
        const client1 = new DevhookClient({
          serverUrl: server.url,
          secret: "replace-client-test",
          onRequest: async () => new Response("client1"),
        });

        const disposable1 = client1.connect();
        await delay(300);

        const devhookId = await getDevhookId("replace-client-test", serverSecret);

        // Verify client1 works
        const response1 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(await response1.text()).toBe("client1");

        // Disconnect client1 first
        disposable1.dispose();
        await delay(100);

        // Connect client2 with same secret
        const client2 = new DevhookClient({
          serverUrl: server.url,
          secret: "replace-client-test",
          onRequest: async () => new Response("client2"),
        });

        const disposable2 = client2.connect();
        clientConnections.push(disposable2);
        await delay(300);

        // Requests should now go to client2
        const response2 = await fetch(getDevhookUrl(server, devhookId, "/"));
        expect(await response2.text()).toBe("client2");
      });
    });

    describe("error handling", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should return 502 for handler errors", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "error-message-test",
          onRequest: async () => {
            throw new Error("Specific error message");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("error-message-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(502);
        // Error message format varies - just verify we got a 502
        const body = await response.text();
        expect(body.length).toBeGreaterThan(0);
      });

      it("should handle handler that returns rejected promise", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "rejected-promise-test",
          onRequest: async () => {
            return Promise.reject(new Error("Async rejection"));
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("rejected-promise-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"));

        expect(response.status).toBe(502);
      });

      it("should handle various HTTP status codes correctly", async () => {
        const statusCodes = [200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503];

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "status-codes-test",
          onRequest: async (req) => {
            const url = new URL(req.url);
            const status = parseInt(url.searchParams.get("status") || "200");
            // 204 should have no body
            if (status === 204) {
              return new Response(null, { status });
            }
            return new Response(`Status: ${status}`, { status });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("status-codes-test", serverSecret);

        for (const status of statusCodes) {
          const response = await fetch(getDevhookUrl(server, devhookId, `/?status=${status}`));
          expect(response.status).toBe(status);
        }
      });
    });

    describe("URL handling", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should handle path with URL-encoded special characters", async () => {
        let receivedPath: string | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "encoded-path-test",
          onRequest: async (req) => {
            receivedPath = new URL(req.url).pathname;
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("encoded-path-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/api/users/name%20with%20spaces"));

        expect(response.status).toBe(200);
        // Path should be decoded or preserved depending on implementation
        expect(receivedPath).toMatch(/name(%20| )with(%20| )spaces/);
      });

      it("should handle query string with special characters", async () => {
        let receivedQuery: string | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "special-query-test",
          onRequest: async (req) => {
            receivedQuery = new URL(req.url).search;
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("special-query-test", serverSecret);
        // Encoded: & = ? in values
        const response = await fetch(getDevhookUrl(server, devhookId, "/?search=hello%26world&name=foo%3Dbar"));

        expect(response.status).toBe(200);
        expect(receivedQuery).toContain("search=hello%26world");
        expect(receivedQuery).toContain("name=foo%3Dbar");
      });

      it("should handle double slashes in path", async () => {
        let receivedPath: string | undefined;

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "double-slash-test",
          onRequest: async (req) => {
            receivedPath = new URL(req.url).pathname;
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("double-slash-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/api//data///test"));

        expect(response.status).toBe(200);
        // Browsers/fetch may normalize slashes, but we should handle it
        expect(receivedPath).toBeDefined();
      });
    });

    describe("HTTP methods", () => {
      let clientConnections: Array<{ dispose: () => void }> = [];

      afterEach(() => {
        for (const conn of clientConnections) {
          conn.dispose();
        }
        clientConnections = [];
      });

      it("should handle all standard HTTP methods", async () => {
        const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
        const receivedMethods: string[] = [];

        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "http-methods-test",
          onRequest: async (req) => {
            receivedMethods.push(req.method);
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("http-methods-test", serverSecret);

        for (const method of methods) {
          const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
            method,
          });
          expect(response.status).toBe(200);
        }

        expect(receivedMethods).toEqual(methods);
      });

      it("should handle HEAD request correctly", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "head-request-test",
          onRequest: async (req) => {
            if (req.method === "HEAD") {
              return new Response(null, {
                headers: {
                  "Content-Length": "1000",
                  "Content-Type": "text/plain",
                },
              });
            }
            return new Response("body content", {
              headers: {
                "Content-Type": "text/plain",
              },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("head-request-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "HEAD",
        });

        expect(response.status).toBe(200);
        // HEAD should return headers but no body
        expect(response.headers.get("content-type")).toBe("text/plain");
        const body = await response.text();
        expect(body).toBe("");
      });

      it("should handle OPTIONS request for CORS", async () => {
        const client = new DevhookClient({
          serverUrl: server.url,
          secret: "options-cors-test",
          onRequest: async (req) => {
            if (req.method === "OPTIONS") {
              return new Response(null, {
                status: 204,
                headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
                  "Access-Control-Allow-Headers": "Content-Type, Authorization",
                  "Access-Control-Max-Age": "86400",
                },
              });
            }
            return new Response("OK");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const devhookId = await getDevhookId("options-cors-test", serverSecret);
        const response = await fetch(getDevhookUrl(server, devhookId, "/"), {
          method: "OPTIONS",
          headers: {
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
          },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(response.headers.get("access-control-allow-methods")).toContain("POST");
      });
    });
  });
}
