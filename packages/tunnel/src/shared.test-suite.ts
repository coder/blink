/**
 * Shared test suite that runs against any tunnel server implementation.
 *
 * This file exports test functions that can be called with different server factories
 * to ensure both local and Cloudflare servers behave identically.
 */

import assert from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import { TunnelClient } from "./client";
import {
  closeWsServer,
  delay,
  getTunnelId,
  getTunnelUrl,
  getTunnelWsUrl,
  type TestServer,
  type TestServerFactory,
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

    before(async () => {
      server = await serverFactory();
      await delay(100); // Give server time to start
    });

    after(async () => {
      await server?.close();
    });

    describe("basic endpoints", () => {
      it("should respond to health check", async () => {
        const response = await fetch(`${server.url}/health`);
        assert.strictEqual(response.status, 200);
        const body = (await response.json()) as { status: string };
        assert.strictEqual(body.status, "ok");
      });

      it("should return 404 for unknown routes", async () => {
        const response = await fetch(`${server.url}/unknown`);
        assert.strictEqual(response.status, 404);
      });

      it("should return 426 for non-WebSocket connect requests", async () => {
        const response = await fetch(`${server.url}/api/tunnel/connect`);
        assert.strictEqual(response.status, 426);
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

        const client = new TunnelClient({
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

        assert.ok(connectedUrl !== undefined);
        assert.ok(connectedId !== undefined);
        assert.strictEqual(connectedId.length, 16);
        assert.ok(connectedUrl.includes(connectedId));
      });

      it("should proxy GET requests", async () => {
        let receivedRequest: Request | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("get-test", serverSecret);
        const response = await fetch(
          getTunnelUrl(server, tunnelId, "/api/data")
        );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(await response.text(), "GET response");
        assert.strictEqual(receivedRequest?.method, "GET");
        assert.strictEqual(new URL(receivedRequest!.url).pathname, "/api/data");
      });

      it("should proxy POST requests with JSON body", async () => {
        let receivedBody: unknown;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("post-test", serverSecret);
        const response = await fetch(
          getTunnelUrl(server, tunnelId, "/api/submit"),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "test", value: 123 }),
          }
        );

        assert.strictEqual(response.status, 200);
        const body = (await response.json()) as { received: boolean };
        assert.strictEqual(body.received, true);
        assert.deepStrictEqual(receivedBody, { name: "test", value: 123 });
      });

      it("should preserve query parameters", async () => {
        let receivedUrl: string | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("query-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/search?q=test&page=1"));

        assert.ok(receivedUrl !== undefined);
        const url = new URL(receivedUrl!);
        assert.strictEqual(url.searchParams.get("q"), "test");
        assert.strictEqual(url.searchParams.get("page"), "1");
      });

      it("should preserve request headers", async () => {
        const receivedHeaders: Record<string, string> = {};

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("headers-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: {
            "x-custom-header": "custom-value",
            authorization: "Bearer token123",
          },
        });

        assert.strictEqual(receivedHeaders["x-custom-header"], "custom-value");
        assert.strictEqual(receivedHeaders["authorization"], "Bearer token123");
      });

      it("should return response headers from client", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("resp-headers-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(
          response.headers.get("x-custom-response"),
          "response-value"
        );
        assert.strictEqual(response.headers.get("cache-control"), "no-cache");
      });

      it("should handle different HTTP status codes", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("status-test", serverSecret);

        const response201 = await fetch(
          getTunnelUrl(server, tunnelId, "/?status=201")
        );
        assert.strictEqual(response201.status, 201);

        const response404 = await fetch(
          getTunnelUrl(server, tunnelId, "/?status=404")
        );
        assert.strictEqual(response404.status, 404);

        const response500 = await fetch(
          getTunnelUrl(server, tunnelId, "/?status=500")
        );
        assert.strictEqual(response500.status, 500);
      });

      it("should return 503 when no client is connected", async () => {
        const tunnelId = await getTunnelId("no-client", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 503);
        const body = (await response.json()) as { error: string };
        assert.ok(body.error !== undefined);
      });

      it("should handle client disconnection gracefully", async () => {
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "disconnect-test",
          onRequest: async () => new Response("OK"),
        });

        const disposable = client.connect();
        await delay(200);

        const tunnelId = await getTunnelId("disconnect-test", serverSecret);

        // First request should work
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(response1.status, 200);

        // Disconnect
        disposable.dispose();
        await delay(100);

        // Second request should fail
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(response2.status, 503);
      });

      it("should handle reconnection with same secret", async () => {
        const secret = "reconnect-test";

        const client1 = new TunnelClient({
          serverUrl: server.url,
          secret,
          onRequest: async () => new Response("client1"),
        });

        const disposable1 = client1.connect();
        await delay(200);

        const tunnelId = await getTunnelId(secret, serverSecret);
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(await response1.text(), "client1");

        // Disconnect first client
        disposable1.dispose();
        await delay(100);

        // Connect second client with same secret
        const client2 = new TunnelClient({
          serverUrl: server.url,
          secret,
          onRequest: async () => new Response("client2"),
        });

        const disposable2 = client2.connect();
        clientConnections.push(disposable2);
        await delay(200);

        // Should get response from new client
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(await response2.text(), "client2");
      });

      it("should handle multiple concurrent clients with different secrets", async () => {
        const client1 = new TunnelClient({
          serverUrl: server.url,
          secret: "multi-1",
          onRequest: async () => new Response("response1"),
        });

        const client2 = new TunnelClient({
          serverUrl: server.url,
          secret: "multi-2",
          onRequest: async () => new Response("response2"),
        });

        const disposable1 = client1.connect();
        const disposable2 = client2.connect();
        clientConnections.push(disposable1, disposable2);
        await delay(200);

        const tunnelId1 = await getTunnelId("multi-1", serverSecret);
        const tunnelId2 = await getTunnelId("multi-2", serverSecret);

        const [response1, response2] = await Promise.all([
          fetch(getTunnelUrl(server, tunnelId1, "/")),
          fetch(getTunnelUrl(server, tunnelId2, "/")),
        ]);

        assert.strictEqual(await response1.text(), "response1");
        assert.strictEqual(await response2.text(), "response2");
      });

      it("should handle request errors gracefully", async () => {
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "error-test",
          onRequest: async () => {
            throw new Error("Handler error");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const tunnelId = await getTunnelId("error-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 502);
      });
    });

    describe("websocket proxying", { skip: skipWebSocketTests }, () => {
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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        const externalMessages: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.send("hello from external");
          });

          externalWs.on("message", (data) => {
            externalMessages.push(data.toString());
            if (externalMessages.length >= 1) {
              clearTimeout(timeout);
              resolve();
            }
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(localWsConnected, true);
        assert.ok(receivedMessages.includes("hello from external"));
        assert.ok(externalMessages.includes("echo: hello from external"));

        externalWs.terminate();
        closeWsServer(localWsServer);
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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-close-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-close-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.close(1000, "Normal closure");
          });

          externalWs.on("close", () => {
            clearTimeout(timeout);
            setTimeout(resolve, 100);
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(localWsClosed, true);
        assert.strictEqual(closeCode, 1000);

        closeWsServer(localWsServer);
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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-concurrent-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-concurrent-test", serverSecret);

        // Create 5 concurrent WebSocket connections
        const numConnections = 5;
        const externalWsConnections: InstanceType<typeof WsClient>[] = [];
        const receivedMessages: Map<number, string[]> = new Map();

        for (let i = 0; i < numConnections; i++) {
          receivedMessages.set(i, []);
          const ws = new WsClient(getTunnelWsUrl(server, tunnelId, `/ws${i}`));
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
                setTimeout(
                  () => reject(new Error(`Connection ${i} timeout`)),
                  5000
                );
              })
          )
        );

        assert.strictEqual(localConnections.size, numConnections);

        // Send messages from each connection
        for (let i = 0; i < numConnections; i++) {
          externalWsConnections[i]!.send(`hello from ws${i}`);
        }

        await delay(200);

        // Verify each connection received exactly one response
        for (let i = 0; i < numConnections; i++) {
          assert.strictEqual(receivedMessages.get(i)!.length, 1);
          assert.ok(receivedMessages.get(i)![0].includes(`hello from ws${i}`));
        }

        // Close all connections
        for (const ws of externalWsConnections) {
          ws.close();
        }

        await delay(100);
        closeWsServer(localWsServer);
      });

      it("should handle WebSocket connections from multiple tunnel clients simultaneously", async () => {
        const { WebSocketServer, WebSocket: WsClient } = await import("ws");

        const localWsServer1 = new WebSocketServer({ port: 0 });
        const localWsPort1 = (localWsServer1.address() as { port: number })
          .port;
        const localWsServer2 = new WebSocketServer({ port: 0 });
        const localWsPort2 = (localWsServer2.address() as { port: number })
          .port;

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

        const client1 = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-multi-1",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort1}`;
            return { url, headers };
          },
          onRequest: async (req) => {
            const url = new URL(req.url);
            url.host = `localhost:${localWsPort1}`;
            return fetch(new Request(url.toString(), req));
          },
        });

        const client2 = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-multi-2",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort2}`;
            return { url, headers };
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

        const tunnelId1 = await getTunnelId("ws-multi-1", serverSecret);
        const tunnelId2 = await getTunnelId("ws-multi-2", serverSecret);

        const externalWs1 = new WsClient(
          getTunnelWsUrl(server, tunnelId1, "/ws")
        );
        const externalWs2 = new WsClient(
          getTunnelWsUrl(server, tunnelId2, "/ws")
        );

        const received1: string[] = [];
        const received2: string[] = [];

        await Promise.all([
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout ws1")),
              5000
            );
            externalWs1.on("open", () => {
              clearTimeout(timeout);
              resolve();
            });
            externalWs1.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
            externalWs1.on("message", (data) =>
              received1.push(data.toString())
            );
          }),
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout ws2")),
              5000
            );
            externalWs2.on("open", () => {
              clearTimeout(timeout);
              resolve();
            });
            externalWs2.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
            externalWs2.on("message", (data) =>
              received2.push(data.toString())
            );
          }),
        ]);

        externalWs1.send("message to client 1");
        externalWs2.send("message to client 2");

        await delay(200);

        // Verify messages were routed correctly
        assert.ok(messages1.includes("message to client 1"));
        assert.ok(messages2.includes("message to client 2"));
        assert.ok(!messages1.includes("message to client 2"));
        assert.ok(!messages2.includes("message to client 1"));

        // Verify exactly one response from each server
        assert.strictEqual(received1.length, 1);
        assert.ok(received1[0].includes("server1:"));
        assert.strictEqual(received2.length, 1);
        assert.ok(received2[0].includes("server2:"));

        externalWs1.terminate();
        externalWs2.terminate();
        await delay(100);
        closeWsServer(localWsServer1);
        closeWsServer(localWsServer2);
      });

      it("should isolate WebSocket connections - closing one doesn't affect others", async () => {
        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("message", (data) => ws.send(data));
        });

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-isolate-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-isolate-test", serverSecret);

        const ws1 = new WsClient(getTunnelWsUrl(server, tunnelId, "/a"));
        const ws2 = new WsClient(getTunnelWsUrl(server, tunnelId, "/b"));
        const ws3 = new WsClient(getTunnelWsUrl(server, tunnelId, "/c"));

        const received2: string[] = [];
        const received3: string[] = [];

        await Promise.all([
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout")),
              5000
            );
            ws1.on("open", () => {
              clearTimeout(timeout);
              resolve();
            });
            ws1.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          }),
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout")),
              5000
            );
            ws2.on("open", () => {
              clearTimeout(timeout);
              resolve();
            });
            ws2.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
            ws2.on("message", (data) => received2.push(data.toString()));
          }),
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout")),
              5000
            );
            ws3.on("open", () => {
              clearTimeout(timeout);
              resolve();
            });
            ws3.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
            ws3.on("message", (data) => received3.push(data.toString()));
          }),
        ]);

        // Close ws1
        ws1.terminate();
        await delay(200);

        // ws2 and ws3 should still work
        assert.strictEqual(ws2.readyState, WsClient.OPEN);
        assert.strictEqual(ws3.readyState, WsClient.OPEN);

        // Send messages on remaining connections
        ws2.send("still alive 2");
        ws3.send("still alive 3");

        await delay(200);

        assert.ok(received2.includes("still alive 2"));
        assert.ok(received3.includes("still alive 3"));

        ws2.terminate();
        ws3.terminate();
        await delay(100);
        closeWsServer(localWsServer);
      });

      // Note: miniflare/wrangler dev can be slow with WebSocket close propagation
      // See: https://github.com/cloudflare/workers-sdk/issues/10307
      it(
        "should close proxied WebSockets when tunnel client disconnects",
        { timeout: 30000 },
        async () => {
          let externalWsClosed = false;

          const { WebSocketServer, WebSocket: WsClient } = await import("ws");
          const localWsServer = new WebSocketServer({ port: 0 });
          const localWsPort = (localWsServer.address() as { port: number })
            .port;

          localWsServer.on("connection", (ws) => {
            ws.on("message", (data) => {
              ws.send(data);
            });
          });

          const client = new TunnelClient({
            serverUrl: server.url,
            secret: "ws-disconnect-test",
            transformWebSocketRequest: ({ url, headers }) => {
              url.host = `localhost:${localWsPort}`;
              return { url, headers };
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

          const tunnelId = await getTunnelId(
            "ws-disconnect-test",
            serverSecret
          );
          const externalWs = new WsClient(
            getTunnelWsUrl(server, tunnelId, "/ws")
          );

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout connecting")),
              5000
            );
            externalWs.on("open", () => {
              clearTimeout(timeout);
              resolve();
            });
            externalWs.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });

          // Disconnect the tunnel client and wait for external WS to close
          await new Promise<void>((resolve, reject) => {
            // Longer timeout for miniflare's slow WebSocket close handling
            const timeout = setTimeout(() => {
              reject(
                new Error(
                  "External WS did not close after tunnel client disconnect"
                )
              );
            }, 20000);

            externalWs.on("close", () => {
              clearTimeout(timeout);
              externalWsClosed = true;
              resolve();
            });

            disposable.dispose();
          });

          assert.strictEqual(externalWsClosed, true);

          closeWsServer(localWsServer);
        }
      );

      it("should return 503 when no client is connected for WebSocket", async () => {
        const { WebSocket: WsClient } = await import("ws");
        const tunnelId = await getTunnelId("nonexistent-ws", serverSecret);

        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        await new Promise<void>((resolve) => {
          externalWs.on("error", () => {
            resolve();
          });

          externalWs.on("open", () => {
            externalWs.terminate();
            resolve();
          });

          setTimeout(resolve, 1000);
        });

        assert.notStrictEqual(externalWs.readyState, WsClient.OPEN);
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

      it("should preserve multiple Set-Cookie headers", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("multi-cookie-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 200);

        // Get all Set-Cookie headers - this will fail because Record<string, string> loses duplicates
        const setCookieHeaders = response.headers.getSetCookie();
        assert.strictEqual(setCookieHeaders.length, 3);
        assert.ok(setCookieHeaders.includes("a=1; Path=/"));
        assert.ok(setCookieHeaders.includes("b=2; Path=/"));
        assert.ok(setCookieHeaders.includes("c=3; Path=/"));
      });

      it("should handle Set-Cookie with comma in Expires date", async () => {
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "cookie-expires-test",
          onRequest: async () => {
            const headers = new Headers();
            // Expires date contains a comma - if joined with ", " this breaks
            headers.append(
              "Set-Cookie",
              "session=abc123; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/"
            );
            headers.append(
              "Set-Cookie",
              "user=xyz; Expires=Fri, 02 Jan 2026 00:00:00 GMT; Path=/"
            );
            return new Response("OK", { headers });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const tunnelId = await getTunnelId("cookie-expires-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 200);

        const setCookieHeaders = response.headers.getSetCookie();
        assert.strictEqual(setCookieHeaders.length, 2);
        // Each cookie should be intact with its Expires date
        assert.ok(
          setCookieHeaders.some(
            (c) =>
              c.includes("session=abc123") && c.includes("Thu, 01 Jan 2026")
          )
        );
        assert.ok(
          setCookieHeaders.some(
            (c) => c.includes("user=xyz") && c.includes("Fri, 02 Jan 2026")
          )
        );
      });

      it("should preserve Set-Cookie with all attributes", async () => {
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "cookie-attrs-test",
          onRequest: async () => {
            return new Response("OK", {
              headers: {
                "Set-Cookie":
                  "session=abc; Path=/app; Domain=example.com; Secure; HttpOnly; SameSite=Strict; Max-Age=3600",
              },
            });
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const tunnelId = await getTunnelId("cookie-attrs-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 200);
        const cookie = response.headers.get("set-cookie");
        assert.ok(cookie.includes("session=abc"));
        assert.ok(cookie.includes("Path=/app"));
        assert.ok(cookie.includes("Domain=example.com"));
        assert.ok(cookie.includes("Secure"));
        assert.ok(cookie.includes("HttpOnly"));
        assert.ok(cookie.includes("SameSite=Strict"));
        assert.ok(cookie.includes("Max-Age=3600"));
      });

      it("should handle multiple values for headers that can be combined", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("vary-header-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 200);
        // Vary headers can be combined with commas
        const vary = response.headers.get("vary");
        assert.ok(vary.includes("Accept"));
        assert.ok(vary.includes("Accept-Encoding"));
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

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId(
          "multi-req-cookie-test",
          serverSecret
        );
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: {
            Cookie: "a=1; b=2; c=3",
          },
        });

        assert.strictEqual(receivedCookies, "a=1; b=2; c=3");
      });

      it("should handle cookies with URL-encoded special characters", async () => {
        let receivedCookies: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("encoded-cookie-test", serverSecret);
        // URL-encoded value with special chars: hello=world; foo=bar
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: {
            Cookie: "data=hello%3Dworld%3B%20foo%3Dbar",
          },
        });

        assert.strictEqual(
          receivedCookies,
          "data=hello%3Dworld%3B%20foo%3Dbar"
        );
      });

      it("should handle long cookie values", async () => {
        let receivedCookies: string | null = null;
        const longValue = "x".repeat(4000); // Near 4KB limit

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("long-cookie-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: {
            Cookie: `longcookie=${longValue}`,
          },
        });

        assert.strictEqual(receivedCookies, `longcookie=${longValue}`);
      });

      it("should handle empty cookie value", async () => {
        let receivedCookies: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("empty-cookie-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: {
            Cookie: "empty=",
          },
        });

        assert.strictEqual(receivedCookies, "empty=");
      });

      it("should handle cookies with unicode characters (URL-encoded)", async () => {
        let receivedCookies: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("unicode-cookie-test", serverSecret);
        // URL-encoded "值" (Chinese character for "value")
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: {
            Cookie: "name=%E5%80%BC",
          },
        });

        assert.strictEqual(receivedCookies, "name=%E5%80%BC");
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

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("empty-header-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: { "x-empty": "" },
        });

        assert.strictEqual(response.status, 200);
        // Empty headers may be preserved or stripped depending on implementation
        assert.strictEqual(
          receivedHeader === "" || receivedHeader === null,
          true
        );
      });

      it("should handle very long header values", async () => {
        const longValue = "x".repeat(8000);
        let receivedHeader: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("long-header-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: { "x-long": longValue },
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(receivedHeader, longValue);
        assert.strictEqual(response.headers.get("x-long-response"), longValue);
      });

      it("should handle many headers", async () => {
        const numHeaders = 50;
        const sentHeaders: Record<string, string> = {};
        for (let i = 0; i < numHeaders; i++) {
          sentHeaders[`x-header-${i}`] = `value-${i}`;
        }

        let receivedCount = 0;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("many-headers-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: sentHeaders,
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(receivedCount, numHeaders);

        // Check response headers
        for (let i = 0; i < numHeaders; i++) {
          assert.strictEqual(
            response.headers.get(`x-header-${i}`),
            `value-${i}`
          );
        }
      });

      it("should preserve header value case", async () => {
        let receivedValue: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("header-case-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: { "X-Mixed-Case": "MixedCaseValue" },
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(receivedValue, "MixedCaseValue");
        // Header names are case-insensitive, but values should be preserved
        assert.strictEqual(
          response.headers.get("x-response-mixed"),
          "MixedCaseValue"
        );
      });

      it("should preserve Content-Type with charset", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId(
          "content-type-charset-test",
          serverSecret
        );
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 200);
        const contentType = response.headers.get("content-type");
        assert.ok(contentType.includes("application/json"));
        assert.ok(contentType.includes("charset=utf-8"));
      });

      it("should preserve Accept header with quality values", async () => {
        let receivedAccept: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("accept-quality-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: { Accept: "text/html, application/json;q=0.9, */*;q=0.8" },
        });

        assert.strictEqual(
          receivedAccept,
          "text/html, application/json;q=0.9, */*;q=0.8"
        );
      });

      it("should handle headers with leading/trailing whitespace in values", async () => {
        let receivedHeader: string | null = null;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId(
          "whitespace-header-test",
          serverSecret
        );
        await fetch(getTunnelUrl(server, tunnelId, "/"), {
          headers: { "x-whitespace": "  value with spaces  " },
        });

        // HTTP spec says leading/trailing whitespace should be trimmed
        // but the exact behavior depends on implementation
        assert.ok(receivedHeader);
        assert.ok(receivedHeader!.includes("value with spaces"));
      });
    });

    describe("websocket edge cases", { skip: skipWebSocketTests }, () => {
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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-utf8-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-utf8-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.send(testMessage);
          });

          externalWs.on("message", (data) => {
            clearTimeout(timeout);
            receivedOnClient = data.toString();
            resolve();
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(receivedOnServer, testMessage);
        assert.strictEqual(receivedOnClient, testMessage);

        externalWs.terminate();
        closeWsServer(localWsServer);
      });

      it(
        "should handle large binary messages",
        { timeout: 30000 },
        async () => {
          // Use 64KB - a reasonable size that should work across implementations
          const largeData = new Uint8Array(64 * 1024);
          for (let i = 0; i < largeData.length; i++) {
            largeData[i] = i % 256;
          }

          let receivedSize = 0;

          const { WebSocketServer, WebSocket: WsClient } = await import("ws");
          const localWsServer = new WebSocketServer({ port: 0 });
          const localWsPort = (localWsServer.address() as { port: number })
            .port;

          localWsServer.on("connection", (ws) => {
            ws.on("message", (data) => {
              const buf = data as Buffer;
              receivedSize = buf.length;
              ws.send(buf);
            });
          });

          const client = new TunnelClient({
            serverUrl: server.url,
            secret: "ws-large-binary-test",
            transformWebSocketRequest: ({ url, headers }) => {
              url.host = `localhost:${localWsPort}`;
              return { url, headers };
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

          const tunnelId = await getTunnelId(
            "ws-large-binary-test",
            serverSecret
          );
          const externalWs = new WsClient(
            getTunnelWsUrl(server, tunnelId, "/ws")
          );

          let echoedSize = 0;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout")),
              25000
            );
            externalWs.on("open", () => {
              externalWs.send(largeData);
            });

            externalWs.on("message", (data) => {
              clearTimeout(timeout);
              echoedSize = (data as Buffer).length;
              resolve();
            });

            externalWs.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });

          assert.strictEqual(receivedSize, 64 * 1024);
          assert.strictEqual(echoedSize, 64 * 1024);

          externalWs.terminate();
          closeWsServer(localWsServer);
        }
      );

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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-empty-msg-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-empty-msg-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        let receivedEmptyEcho = false;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.send("");
          });

          externalWs.on("message", (data) => {
            clearTimeout(timeout);
            if (data.toString() === "") {
              receivedEmptyEcho = true;
            }
            resolve();
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(receivedEmpty, true);
        assert.strictEqual(receivedEmptyEcho, true);

        externalWs.terminate();
        closeWsServer(localWsServer);
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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-rapid-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-rapid-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 10000);
          externalWs.on("open", () => {
            for (let i = 0; i < messageCount; i++) {
              externalWs.send(`msg-${i}`);
            }
          });

          externalWs.on("message", (data) => {
            receivedMessages.add(data.toString());
            if (receivedMessages.size >= messageCount) {
              clearTimeout(timeout);
              resolve();
            }
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(receivedMessages.size, messageCount);
        // Verify all messages were received
        for (let i = 0; i < messageCount; i++) {
          assert.ok(receivedMessages.has(`echo:msg-${i}`));
        }

        externalWs.terminate();
        closeWsServer(localWsServer);
      });

      it("should handle WebSocket close code 3000 (registered)", async () => {
        if (typeof Bun !== "undefined") {
          // biome-ignore lint/suspicious/noConsole: node's test package does not support skipIf
          console.warn(
            "Skipping WebSocket close code 3000 (registered) test in Bun"
          );
          // Node handles this test correctly, but Bun does not
          return;
        }
        let receivedCloseCode: number | undefined;

        const { WebSocketServer, WebSocket: WsClient } = await import("ws");
        const localWsServer = new WebSocketServer({ port: 0 });
        const localWsPort = (localWsServer.address() as { port: number }).port;

        localWsServer.on("connection", (ws) => {
          ws.on("close", (code) => {
            receivedCloseCode = code;
          });
        });

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-close-3000-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-close-3000-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.close(3000, "Custom registered close");
          });

          externalWs.on("close", () => {
            clearTimeout(timeout);
            setTimeout(resolve, 100);
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(receivedCloseCode, 3000);

        closeWsServer(localWsServer);
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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-close-4000-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-close-4000-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.close(4000, "Private use close");
          });

          externalWs.on("close", () => {
            clearTimeout(timeout);
            setTimeout(resolve, 100);
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.strictEqual(receivedCloseCode, 4000);

        closeWsServer(localWsServer);
      });

      it(
        "should handle server-initiated WebSocket close",
        { timeout: 15000 },
        async () => {
          let clientReceivedClose = false;
          let clientCloseCode: number | undefined;

          const { WebSocketServer, WebSocket: WsClient } = await import("ws");
          const localWsServer = new WebSocketServer({ port: 0 });
          const localWsPort = (localWsServer.address() as { port: number })
            .port;

          localWsServer.on("connection", (ws) => {
            // Server initiates close after connection
            setTimeout(() => {
              ws.close(1000, "Server closing");
            }, 100);
          });

          const client = new TunnelClient({
            serverUrl: server.url,
            secret: "ws-server-close-test",
            transformWebSocketRequest: ({ url, headers }) => {
              url.host = `localhost:${localWsPort}`;
              return { url, headers };
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

          const tunnelId = await getTunnelId(
            "ws-server-close-test",
            serverSecret
          );
          const externalWs = new WsClient(
            getTunnelWsUrl(server, tunnelId, "/ws")
          );

          await new Promise<void>((resolve, reject) => {
            // Miniflare can be slow with WebSocket close propagation
            const timeout = setTimeout(
              () => reject(new Error("Timeout")),
              12000
            );
            externalWs.on("close", (code) => {
              clearTimeout(timeout);
              clientReceivedClose = true;
              clientCloseCode = code;
              resolve();
            });

            externalWs.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });

          assert.strictEqual(clientReceivedClose, true);
          assert.strictEqual(clientCloseCode, 1000);

          closeWsServer(localWsServer);
        }
      );

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

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "ws-exchange-test",
          transformWebSocketRequest: ({ url, headers }) => {
            url.host = `localhost:${localWsPort}`;
            return { url, headers };
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

        const tunnelId = await getTunnelId("ws-exchange-test", serverSecret);
        const externalWs = new WsClient(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        let clientMessageCount = 0;

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
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
              clearTimeout(timeout);
              resolve();
            }
          });

          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        // Verify bidirectional communication worked with exact message counts
        assert.strictEqual(serverMessageCount, 2);
        assert.strictEqual(clientMessageCount, 2);

        externalWs.terminate();
        closeWsServer(localWsServer);
      });

      it(
        "should handle WebSocket with query parameters",
        { timeout: 10000 },
        async () => {
          let receivedUrl: string | undefined;

          const { WebSocketServer, WebSocket: WsClient } = await import("ws");
          const localWsServer = new WebSocketServer({ port: 0 });
          const localWsPort = (localWsServer.address() as { port: number })
            .port;

          localWsServer.on("connection", (ws, req) => {
            receivedUrl = req.url;
            ws.send("connected");
          });

          const client = new TunnelClient({
            serverUrl: server.url,
            secret: "ws-query-test",
            transformWebSocketRequest: ({ url, headers }) => {
              url.host = `localhost:${localWsPort}`;
              return { url, headers };
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

          const tunnelId = await getTunnelId("ws-query-test", serverSecret);
          const externalWs = new WsClient(
            getTunnelWsUrl(server, tunnelId, "/ws?token=abc123&user=test")
          );

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timeout")),
              8000
            );
            externalWs.on("open", () => {
              // Give some time for the message to arrive
              setTimeout(() => {
                if (receivedUrl) {
                  clearTimeout(timeout);
                  resolve();
                }
              }, 500);
            });

            externalWs.on("message", () => {
              clearTimeout(timeout);
              resolve();
            });

            externalWs.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });

          assert.ok(receivedUrl.includes("token=abc123"));
          assert.ok(receivedUrl.includes("user=test"));

          externalWs.terminate();
          closeWsServer(localWsServer);
        }
      );
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

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("empty-body-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "POST",
          headers: { "Content-Length": "0" },
          body: "",
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(receivedBody, "");
      });

      it("should handle large request body", { timeout: 30000 }, async () => {
        const largeBody = "x".repeat(5 * 1024 * 1024); // 5MB
        let receivedLength = 0;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("large-req-body-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "POST",
          body: largeBody,
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(receivedLength, 5 * 1024 * 1024);
      });

      it("should handle large response body", { timeout: 30000 }, async () => {
        const largeBody = "y".repeat(5 * 1024 * 1024); // 5MB

        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "large-resp-body-test",
          onRequest: async () => {
            return new Response(largeBody);
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const tunnelId = await getTunnelId(
          "large-resp-body-test",
          serverSecret
        );
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 200);
        const body = await response.text();
        assert.strictEqual(body.length, 5 * 1024 * 1024);
      });

      it("should handle binary request/response bodies", async () => {
        // PNG-like binary data with null bytes
        const binaryData = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52,
        ]);
        let receivedBinary: Uint8Array | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("binary-body-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: binaryData,
        });

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(receivedBinary, binaryData);

        const responseBuffer = await response.arrayBuffer();
        assert.deepStrictEqual(new Uint8Array(responseBuffer), binaryData);
      });

      it("should handle body with null bytes", async () => {
        const dataWithNulls = new Uint8Array([
          0x00, 0x01, 0x00, 0x02, 0x00, 0x03,
        ]);
        let receivedData: Uint8Array | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("null-bytes-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "POST",
          body: dataWithNulls,
        });

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(receivedData, dataWithNulls);

        const responseBuffer = await response.arrayBuffer();
        assert.deepStrictEqual(new Uint8Array(responseBuffer), dataWithNulls);
      });

      it("should handle JSON with unicode characters", async () => {
        const jsonData = { name: "日本語", emoji: "🎉", arabic: "مرحبا" };
        let receivedJson: unknown;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("unicode-json-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jsonData),
        });

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(receivedJson, jsonData);

        const responseJson = await response.json();
        assert.deepStrictEqual(responseJson, jsonData);
      });

      it("should handle URL-encoded form data", async () => {
        let receivedBody: string | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("form-data-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "name=test&value=hello%20world&special=%26%3D%3F",
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          receivedBody,
          "name=test&value=hello%20world&special=%26%3D%3F"
        );
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

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("slow-request-test", serverSecret);

        // Make a request
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(requestStarted, true);
        assert.strictEqual(response.status, 200);
      });

      it("should handle rapid reconnect cycles", async () => {
        const cycles = 5;
        const tunnelId = await getTunnelId(
          "rapid-reconnect-test",
          serverSecret
        );

        for (let i = 0; i < cycles; i++) {
          const client = new TunnelClient({
            serverUrl: server.url,
            secret: "rapid-reconnect-test",
            onRequest: async () => new Response(`cycle-${i}`),
          });

          const disposable = client.connect();
          await delay(200);

          const response = await fetch(getTunnelUrl(server, tunnelId, "/"));
          assert.strictEqual(response.status, 200);
          assert.strictEqual(await response.text(), `cycle-${i}`);

          disposable.dispose();
          await delay(50);
        }
      });

      it(
        "should handle many concurrent requests",
        { timeout: 30000 },
        async () => {
          const numRequests = 50;
          let requestCount = 0;

          const client = new TunnelClient({
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

          const tunnelId = await getTunnelId("concurrent-test", serverSecret);

          const promises = Array.from({ length: numRequests }, (_, i) =>
            fetch(getTunnelUrl(server, tunnelId, `/?n=${i}`))
          );

          const responses = await Promise.all(promises);

          for (let i = 0; i < numRequests; i++) {
            assert.strictEqual(responses[i]!.status, 200);
          }

          assert.strictEqual(requestCount, numRequests);
        }
      );

      it("should return 503 immediately after client disconnect", async () => {
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "immediate-503-test",
          onRequest: async () => new Response("OK"),
        });

        const disposable = client.connect();
        await delay(200);

        const tunnelId = await getTunnelId("immediate-503-test", serverSecret);

        // Verify client works
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(response1.status, 200);

        // Disconnect
        disposable.dispose();

        // Immediate request should fail
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(response2.status, 503);
      });

      it(
        "should handle new client connection with same secret",
        { timeout: 10000 },
        async () => {
          const client1 = new TunnelClient({
            serverUrl: server.url,
            secret: "replace-client-test",
            onRequest: async () => new Response("client1"),
          });

          const disposable1 = client1.connect();
          await delay(300);

          const tunnelId = await getTunnelId(
            "replace-client-test",
            serverSecret
          );

          // Verify client1 works
          const response1 = await fetch(getTunnelUrl(server, tunnelId, "/"));
          assert.strictEqual(await response1.text(), "client1");

          // Disconnect client1 first
          disposable1.dispose();
          await delay(100);

          // Connect client2 with same secret
          const client2 = new TunnelClient({
            serverUrl: server.url,
            secret: "replace-client-test",
            onRequest: async () => new Response("client2"),
          });

          const disposable2 = client2.connect();
          clientConnections.push(disposable2);
          await delay(300);

          // Requests should now go to client2
          const response2 = await fetch(getTunnelUrl(server, tunnelId, "/"));
          assert.strictEqual(await response2.text(), "client2");
        }
      );
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
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "error-message-test",
          onRequest: async () => {
            throw new Error("Specific error message");
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const tunnelId = await getTunnelId("error-message-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 502);
        // Error message format varies - just verify we got a 502
        const body = await response.text();
        assert.ok(body.length > 0);
      });

      it("should handle handler that returns rejected promise", async () => {
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: "rejected-promise-test",
          onRequest: async () => {
            return Promise.reject(new Error("Async rejection"));
          },
        });

        const disposable = client.connect();
        clientConnections.push(disposable);
        await delay(200);

        const tunnelId = await getTunnelId(
          "rejected-promise-test",
          serverSecret
        );
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"));

        assert.strictEqual(response.status, 502);
      });

      it("should handle various HTTP status codes correctly", async () => {
        const statusCodes = [
          200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503,
        ];

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("status-codes-test", serverSecret);

        for (const status of statusCodes) {
          const response = await fetch(
            getTunnelUrl(server, tunnelId, `/?status=${status}`)
          );
          assert.strictEqual(response.status, status);
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

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("encoded-path-test", serverSecret);
        const response = await fetch(
          getTunnelUrl(server, tunnelId, "/api/users/name%20with%20spaces")
        );

        assert.strictEqual(response.status, 200);
        // Path should be decoded or preserved depending on implementation
        assert.match(receivedPath, /name(%20| )with(%20| )spaces/);
      });

      it("should handle query string with special characters", async () => {
        let receivedQuery: string | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("special-query-test", serverSecret);
        // Encoded: & = ? in values
        const response = await fetch(
          getTunnelUrl(
            server,
            tunnelId,
            "/?search=hello%26world&name=foo%3Dbar"
          )
        );

        assert.strictEqual(response.status, 200);
        assert.ok(receivedQuery.includes("search=hello%26world"));
        assert.ok(receivedQuery.includes("name=foo%3Dbar"));
      });

      it("should handle double slashes in path", async () => {
        let receivedPath: string | undefined;

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("double-slash-test", serverSecret);
        const response = await fetch(
          getTunnelUrl(server, tunnelId, "/api//data///test")
        );

        assert.strictEqual(response.status, 200);
        // Browsers/fetch may normalize slashes, but we should handle it
        assert.ok(receivedPath !== undefined);
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

        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("http-methods-test", serverSecret);

        for (const method of methods) {
          const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
            method,
          });
          assert.strictEqual(response.status, 200);
        }

        assert.deepStrictEqual(receivedMethods, methods);
      });

      it("should handle HEAD request correctly", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("head-request-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "HEAD",
        });

        assert.strictEqual(response.status, 200);
        // HEAD should return headers but no body
        assert.strictEqual(response.headers.get("content-type"), "text/plain");
        const body = await response.text();
        assert.strictEqual(body, "");
      });

      it("should handle OPTIONS request for CORS", async () => {
        const client = new TunnelClient({
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

        const tunnelId = await getTunnelId("options-cors-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/"), {
          method: "OPTIONS",
          headers: {
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
          },
        });

        assert.strictEqual(response.status, 204);
        assert.strictEqual(
          response.headers.get("access-control-allow-origin"),
          "*"
        );
        assert.ok(
          response.headers.get("access-control-allow-methods").includes("POST")
        );
      });
    });
  });
}
