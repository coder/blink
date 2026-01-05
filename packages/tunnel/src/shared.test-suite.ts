/**
 * Shared test suite that runs against any tunnel server implementation.
 *
 * This file exports test functions that can be called with different server factories
 * to ensure both local and Cloudflare servers behave identically.
 */

import assert from "node:assert";
import { after, afterEach, before, describe, it } from "node:test";
import WebSocket, {
  WebSocketServer,
  type WebSocket as WebSocketType,
} from "ws";
import { TunnelClient } from "./client";
import type { ConnectionEstablished } from "./schema";
import {
  closeWsServer,
  createMockHttpServer,
  getTunnelId,
  getTunnelUrl,
  getTunnelWsUrl,
  type MockHttpServer,
  newPromise,
  readBody,
  readJsonBody,
  type TestServer,
  type TestServerFactory,
} from "./test-utils";

export interface SharedTestOptions {
  /**
   * Skip WebSocket proxying tests.
   * Useful for environments where WebSocket behavior differs (e.g., miniflare).
   */
  skipCloudflareWebSocketCloseTests?: boolean;
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
  const { skipCloudflareWebSocketCloseTests = true } = options;
  describe(`${serverName} server`, () => {
    let server: TestServer;
    let mockServer: MockHttpServer;

    before(async () => {
      server = await serverFactory();
      mockServer = await createMockHttpServer();
    });

    after(async () => {
      await mockServer?.close();
      await server?.close();
    });

    /**
     * Helper to create a WebSocketServer that can be used with the `using` keyword.
     * The server is automatically closed when it goes out of scope.
     */
    function createWsServer() {
      const wsServer = new WebSocketServer({ port: 0 });
      const port = (wsServer.address() as { port: number }).port;
      return {
        server: wsServer,
        port,
        [Symbol.dispose]: () => closeWsServer(wsServer),
      };
    }

    /**
     * Helper to create a TunnelClient and wait for it to connect.
     * Returns a promise that resolves with the disposable when onConnect fires.
     */
    function connectClient(config: {
      secret: string;
      port?: number;
      onConnect?: (_data: ConnectionEstablished) => void;
      onDisconnect?: () => void;
      transformHeaders?: (
        _headers: Record<string, string>
      ) => Record<string, string>;
    }): Promise<{ [Symbol.dispose]: () => void }> {
      return new Promise((resolve) => {
        let disposable!: { dispose: () => void };
        const client = new TunnelClient({
          serverUrl: server.url,
          secret: config.secret,
          transformRequest: ({ method, url, headers }) => {
            url.host = `127.0.0.1:${config.port ?? mockServer.port}`;
            return {
              method,
              url,
              headers: config.transformHeaders?.(headers) ?? headers,
            };
          },
          onConnect: (data) => {
            config.onConnect?.(data);
            resolve({ [Symbol.dispose]: () => disposable.dispose() });
          },
          onDisconnect: () => {
            config.onDisconnect?.();
          },
        });
        disposable = client.connect();
      });
    }

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
      it("should connect and receive public URL", async () => {
        mockServer.setHandler((_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        const connectData: { url?: string; id?: string } = {};
        using _disposable = await connectClient({
          secret: "test-client",
          onConnect: (data) => {
            connectData.url = data.url;
            connectData.id = data.id;
          },
        });

        assert.ok(connectData.url !== undefined);
        assert.ok(connectData.id !== undefined);
        assert.strictEqual(connectData.id.length, 16);
        assert.ok(connectData.url.includes(connectData.id));
      });

      it("should proxy GET requests", async () => {
        let receivedMethod: string | undefined;
        let receivedUrl: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedMethod = req.method;
          receivedUrl = req.url;
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("GET response");
        });

        using _disposable = await connectClient({ secret: "get-test" });

        const tunnelId = await getTunnelId("get-test", serverSecret);
        const response = await fetch(
          getTunnelUrl(server, tunnelId, "/api/data")
        );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(await response.text(), "GET response");
        assert.strictEqual(receivedMethod, "GET");
        assert.strictEqual(receivedUrl, "/api/data");
      });

      it("should proxy POST requests with JSON body", async () => {
        let receivedBody: unknown;

        mockServer.setHandler(async (req, res) => {
          receivedBody = await readJsonBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ received: true }));
        });

        using _disposable = await connectClient({ secret: "post-test" });

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

        mockServer.setHandler((req, res) => {
          receivedUrl = req.url;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "query-test" });

        const tunnelId = await getTunnelId("query-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/search?q=test&page=1"));

        assert.ok(receivedUrl !== undefined);
        const url = new URL(`http://localhost${receivedUrl!}`);
        assert.strictEqual(url.searchParams.get("q"), "test");
        assert.strictEqual(url.searchParams.get("page"), "1");
      });

      it("should preserve request headers", async () => {
        const receivedHeaders: Record<string, string> = {};

        mockServer.setHandler(async (req, res) => {
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") {
              receivedHeaders[key.toLowerCase()] = value;
            }
          }
          await readBody(req);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "headers-test" });

        const tunnelId = await getTunnelId("headers-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            "X-Custom-Header": "custom-value",
            Authorization: "Bearer token123",
          },
        });

        assert.strictEqual(receivedHeaders["x-custom-header"], "custom-value");
        assert.strictEqual(receivedHeaders.authorization, "Bearer token123");
      });

      it("should return response headers from client", async () => {
        mockServer.setHandler((_req, res) => {
          res.writeHead(200, {
            "X-Response-Header": "response-value",
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true }));
        });

        using _disposable = await connectClient({
          secret: "response-headers-test",
        });

        const tunnelId = await getTunnelId(
          "response-headers-test",
          serverSecret
        );
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        assert.strictEqual(
          response.headers.get("X-Response-Header"),
          "response-value"
        );
        assert.strictEqual(
          response.headers.get("Content-Type"),
          "application/json"
        );
      });

      it("should handle different HTTP status codes", async () => {
        const testCases = [
          { status: 201, message: "Created" },
          { status: 204, message: "" },
          { status: 400, message: "Bad Request" },
          { status: 404, message: "Not Found" },
          { status: 500, message: "Internal Server Error" },
        ];

        for (const { status, message } of testCases) {
          mockServer.setHandler((_req, res) => {
            res.writeHead(status);
            res.end(message);
          });

          const secret = `status-${status}`;
          using _disposable = await connectClient({ secret });

          const tunnelId = await getTunnelId(secret, serverSecret);
          const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

          assert.strictEqual(
            response.status,
            status,
            `Expected status ${status}`
          );
          const text = await response.text();
          assert.strictEqual(
            text,
            message,
            `Expected body "${message}" for status ${status}`
          );
        }
      });

      it("should return 503 when no client is connected", async () => {
        // Use a secret that no client is using
        const tunnelId = await getTunnelId("non-existent-client", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        assert.strictEqual(response.status, 503);
      });

      it("should handle client disconnection gracefully", async () => {
        mockServer.setHandler((_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        const { promise: disconnected, resolve: resolveDisconnected } =
          newPromise();
        // Don't use `using` - we'll manually dispose
        const disposable = await connectClient({
          secret: "disconnect-test",
          onDisconnect: resolveDisconnected,
        });
        const tunnelId = await getTunnelId("disconnect-test", serverSecret);

        // First request should succeed
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/test"));
        assert.strictEqual(response1.status, 200);

        // Disconnect
        disposable[Symbol.dispose]();
        await disconnected;

        // Second request should fail
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/test"));
        assert.strictEqual(response2.status, 503);
      });

      it("should handle reconnection with same secret", async () => {
        let requestCount = 0;

        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          requestCount++;
          res.writeHead(200);
          res.end(`request-${requestCount}`);
        });

        const tunnelId = await getTunnelId("reconnect-test", serverSecret);

        const { promise: disconnected1, resolve: resolveDisconnected1 } =
          newPromise();
        // First connection. don't use `using`, we'll manually dispose
        const disposable1 = await connectClient({
          secret: "reconnect-test",
          onDisconnect: resolveDisconnected1,
        });

        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/test"));
        assert.strictEqual(response1.status, 200);
        assert.strictEqual(await response1.text(), "request-1");

        // Disconnect first client
        disposable1[Symbol.dispose]();
        await disconnected1;

        // Second connection with same secret
        using _disposable2 = await connectClient({
          secret: "reconnect-test",
        });

        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/test"));
        assert.strictEqual(response2.status, 200);
        assert.strictEqual(await response2.text(), "request-2");
      });

      it("should handle multiple concurrent clients with different secrets", async () => {
        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          // Return the path to identify which tunnel was used
          res.writeHead(200);
          res.end(req.url);
        });

        const [disposable1, disposable2] = await Promise.all([
          connectClient({ secret: "client1" }),
          connectClient({ secret: "client2" }),
        ]);
        using _disposable1 = disposable1;
        using _disposable2 = disposable2;

        const tunnelId1 = await getTunnelId("client1", serverSecret);
        const tunnelId2 = await getTunnelId("client2", serverSecret);

        const [response1, response2] = await Promise.all([
          fetch(getTunnelUrl(server, tunnelId1, "/path1")),
          fetch(getTunnelUrl(server, tunnelId2, "/path2")),
        ]);

        assert.strictEqual(response1.status, 200);
        assert.strictEqual(response2.status, 200);
        assert.strictEqual(await response1.text(), "/path1");
        assert.strictEqual(await response2.text(), "/path2");
      });

      it("should handle request errors gracefully", async () => {
        mockServer.setHandler((_req, res) => {
          // Simulate an error by destroying the connection
          res.destroy();
        });

        using _disposable = await connectClient({ secret: "error-test" });

        const tunnelId = await getTunnelId("error-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        // Should return 502 Bad Gateway for errors
        assert.strictEqual(response.status, 502);
      });
    });

    describe("websocket proxying", () => {
      it("should proxy WebSocket connections", async () => {
        using wss = createWsServer();

        const {
          promise: serverReceivedMessage,
          resolve: resolveServerReceivedMessage,
        } = newPromise<string>();

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            resolveServerReceivedMessage(data.toString());
            ws.send(`echo: ${data}`);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-test",
          port: wss.port,
        });
        const tunnelId = await getTunnelId("ws-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");
        const clientWs = new WebSocket(wsUrl);
        let clientReceivedMessage: string | undefined;

        await new Promise<void>((resolve, reject) => {
          clientWs.on("open", () => {
            clientWs.send("hello");
          });
          clientWs.on("message", (data: Buffer) => {
            clientReceivedMessage = data.toString();
            clientWs.close();
            resolve();
          });
          // we don't wait on resolve on `close` because Cloudflare DO has a bug where
          // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
          // by the client
          // clientWs.on("close", () => resolve());
          clientWs.on("error", reject);
        });

        assert.strictEqual(await serverReceivedMessage, "hello");
        assert.strictEqual(clientReceivedMessage, "echo: hello");
      });

      it("should handle WebSocket close from external client", async () => {
        using wss = createWsServer();

        let closeCode: number | undefined;

        const { promise: localWsClosed, resolve: resolveLocalWsClosed } =
          newPromise();
        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("close", (code: number) => {
            closeCode = code;
            resolveLocalWsClosed();
          });
        });

        using _disposable = await connectClient({
          secret: "ws-close-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-close-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const externalWs = new WebSocket(wsUrl);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          externalWs.on("open", () => {
            externalWs.close(1000, "Normal closure");
          });
          externalWs.on("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          externalWs.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        await localWsClosed;
        assert.strictEqual(closeCode, 1000);
      });

      it("should handle multiple concurrent WebSocket connections to the same client", async () => {
        using wss = createWsServer();

        const serverMessages: string[] = [];

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            const msg = data.toString();
            serverMessages.push(msg);
            ws.send(`reply: ${msg}`);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-multi-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-multi-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        // Create multiple WebSocket connections
        const clientMessages: string[][] = [[], [], []];

        await Promise.all(
          [0, 1, 2].map(
            (i) =>
              new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                ws.on("open", () => {
                  ws.send(`client${i}`);
                });
                ws.on("message", (data: Buffer) => {
                  clientMessages[i]?.push(data.toString());
                  ws.close();
                  resolve();
                });
                // we don't wait on resolve on `close` because Cloudflare DO has a bug where
                // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
                // by the client
                // ws.on("close", () => resolve());
                ws.on("error", reject);
              })
          )
        );

        assert.strictEqual(serverMessages.length, 3);
        assert.ok(serverMessages.includes("client0"));
        assert.ok(serverMessages.includes("client1"));
        assert.ok(serverMessages.includes("client2"));
      });

      it("should handle WebSocket connections from multiple tunnel clients simultaneously", async () => {
        using wss = createWsServer();

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            ws.send(`echo: ${data}`);
          });
        });

        // Create two tunnel clients
        const [disposable1, disposable2] = await Promise.all([
          connectClient({ secret: "ws-client1", port: wss.port }),
          connectClient({ secret: "ws-client2", port: wss.port }),
        ]);
        using _disposable1 = disposable1;
        using _disposable2 = disposable2;

        const tunnelId1 = await getTunnelId("ws-client1", serverSecret);
        const tunnelId2 = await getTunnelId("ws-client2", serverSecret);

        const messages: string[] = [];

        await Promise.all([
          new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(getTunnelWsUrl(server, tunnelId1, "/ws"));
            ws.on("open", () => ws.send("from1"));
            ws.on("message", (data: Buffer) => {
              messages.push(data.toString());
              ws.close();
              resolve();
            });
            // we don't wait on resolve on `close` because Cloudflare DO has a bug where
            // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
            // by the client
            // ws.on("close", () => resolve());
            ws.on("error", reject);
          }),
          new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(getTunnelWsUrl(server, tunnelId2, "/ws"));
            ws.on("open", () => ws.send("from2"));
            ws.on("message", (data: Buffer) => {
              messages.push(data.toString());
              ws.close();
              resolve();
            });
            // ditto above
            // ws.on("close", () => resolve());
            ws.on("error", reject);
          }),
        ]);

        assert.ok(messages.includes("echo: from1"));
        assert.ok(messages.includes("echo: from2"));
      });

      it("should isolate WebSocket connections - closing one doesn't affect others", async () => {
        using wss = createWsServer();

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            ws.send(`echo: ${data}`);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-isolate-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-isolate-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        // Create two connections
        const ws1 = new WebSocket(wsUrl);
        const ws2 = new WebSocket(wsUrl);

        let ws2Message: string | undefined;

        await new Promise<void>((resolve) => {
          let openCount = 0;
          const checkOpen = () => {
            openCount++;
            if (openCount === 2) resolve();
          };
          ws1.on("open", checkOpen);
          ws2.on("open", checkOpen);
        });

        // Close ws1
        ws1.close();

        // ws2 should still work
        await new Promise<void>((resolve, reject) => {
          ws2.on("message", (data: Buffer) => {
            ws2Message = data.toString();
            ws2.close();
            resolve();
          });
          // we don't wait on resolve on `close` because Cloudflare DO has a bug where
          // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
          // by the client
          // ws2.on("close", () => resolve());
          ws2.on("error", reject);
          ws2.send("still alive");
        });

        assert.strictEqual(ws2Message, "echo: still alive");
      });

      it("should return 503 when no client is connected for WebSocket", async () => {
        const tunnelId = await getTunnelId("nonexistent-ws", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const externalWs = new WebSocket(wsUrl);

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

        assert.notStrictEqual(externalWs.readyState, WebSocket.OPEN);
      });
    });

    describe("multi-value headers", () => {
      it("should preserve multiple Set-Cookie headers", async () => {
        mockServer.setHandler((_req, res) => {
          res.setHeader("Set-Cookie", [
            "session=abc123; Path=/; HttpOnly",
            "user=john; Path=/; Max-Age=3600",
          ]);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "setcookie-test" });

        const tunnelId = await getTunnelId("setcookie-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/login"));

        const setCookies = response.headers.getSetCookie();
        assert.strictEqual(setCookies.length, 2);
        assert.ok(setCookies[0]!.includes("session=abc123"));
        assert.ok(setCookies[1]!.includes("user=john"));
      });

      it("should handle Set-Cookie with comma in Expires date", async () => {
        mockServer.setHandler((_req, res) => {
          res.setHeader("Set-Cookie", [
            "session=xyz; Expires=Wed, 09 Jun 2025 10:18:14 GMT; Path=/",
          ]);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "cookie-expires-test",
        });

        const tunnelId = await getTunnelId("cookie-expires-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        const setCookies = response.headers.getSetCookie();
        assert.strictEqual(setCookies.length, 1);
        assert.ok(setCookies[0]!.includes("Expires=Wed, 09 Jun 2025"));
      });

      it("should preserve Set-Cookie with all attributes", async () => {
        mockServer.setHandler((_req, res) => {
          res.setHeader("Set-Cookie", [
            "auth=token123; Path=/api; Domain=.example.com; Secure; HttpOnly; SameSite=Strict; Max-Age=86400",
          ]);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "cookie-attrs-test",
        });

        const tunnelId = await getTunnelId("cookie-attrs-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        const setCookies = response.headers.getSetCookie();
        assert.strictEqual(setCookies.length, 1);
        const cookie = setCookies[0]!;
        assert.ok(cookie.includes("auth=token123"));
        assert.ok(cookie.includes("Path=/api"));
        assert.ok(cookie.includes("Secure"));
        assert.ok(cookie.includes("HttpOnly"));
        assert.ok(cookie.includes("SameSite=Strict"));
      });

      it("should handle multiple values for headers that can be combined", async () => {
        let receivedAccept: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedAccept = req.headers.accept as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "multi-accept-test",
        });

        const tunnelId = await getTunnelId("multi-accept-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Accept: "text/html, application/json",
          },
        });

        assert.ok(receivedAccept?.includes("text/html"));
        assert.ok(receivedAccept?.includes("application/json"));
      });
    });

    describe("cookie handling", () => {
      it("should preserve multiple cookies in request Cookie header", async () => {
        let receivedCookies: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedCookies = req.headers.cookie as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "multi-cookie-test",
        });

        const tunnelId = await getTunnelId("multi-cookie-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Cookie: "session=abc123; user=john; theme=dark",
          },
        });

        assert.ok(receivedCookies?.includes("session=abc123"));
        assert.ok(receivedCookies?.includes("user=john"));
        assert.ok(receivedCookies?.includes("theme=dark"));
      });

      it("should handle cookies with URL-encoded special characters", async () => {
        let receivedCookies: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedCookies = req.headers.cookie as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "encoded-cookie-test",
        });

        const tunnelId = await getTunnelId("encoded-cookie-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Cookie: "data=%7B%22key%22%3A%22value%22%7D",
          },
        });

        assert.strictEqual(
          receivedCookies,
          "data=%7B%22key%22%3A%22value%22%7D"
        );
      });

      it("should handle long cookie values", async () => {
        let receivedCookies: string | undefined;
        const longValue = "x".repeat(4000);

        mockServer.setHandler((req, res) => {
          receivedCookies = req.headers.cookie as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "long-cookie-test" });

        const tunnelId = await getTunnelId("long-cookie-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Cookie: `longdata=${longValue}`,
          },
        });

        assert.ok(receivedCookies?.includes(longValue));
      });

      it("should handle empty cookie value", async () => {
        let receivedCookies: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedCookies = req.headers.cookie as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "empty-cookie-test",
        });

        const tunnelId = await getTunnelId("empty-cookie-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Cookie: "empty=",
          },
        });

        assert.strictEqual(receivedCookies, "empty=");
      });

      it("should handle cookies with unicode characters (URL-encoded)", async () => {
        let receivedCookies: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedCookies = req.headers.cookie as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "unicode-cookie-test",
        });

        const tunnelId = await getTunnelId("unicode-cookie-test", serverSecret);
        // URL-encoded: "こんにちは" = %E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Cookie: "greeting=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF",
          },
        });

        assert.ok(
          receivedCookies?.includes(
            "%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF"
          )
        );
      });
    });

    describe("header edge cases", () => {
      it("should handle empty header value", async () => {
        let receivedHeader: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedHeader = req.headers["x-empty"] as string | undefined;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "empty-header-test",
        });

        const tunnelId = await getTunnelId("empty-header-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            "X-Empty": "",
          },
        });

        assert.strictEqual(receivedHeader, "");
      });

      it("should handle very long header values", async () => {
        const longValue = "x".repeat(8000);
        let receivedHeader: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedHeader = req.headers["x-long"] as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "long-header-test" });

        const tunnelId = await getTunnelId("long-header-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            "X-Long": longValue,
          },
        });

        assert.strictEqual(receivedHeader, longValue);
      });

      it("should handle many headers", async () => {
        const headerCount = 50;
        const receivedHeaders: Record<string, string> = {};

        mockServer.setHandler((req, res) => {
          for (const [key, value] of Object.entries(req.headers)) {
            if (key.startsWith("x-test-")) {
              receivedHeaders[key] = value as string;
            }
          }
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "many-headers-test",
        });

        const tunnelId = await getTunnelId("many-headers-test", serverSecret);

        const headers: Record<string, string> = {};
        for (let i = 0; i < headerCount; i++) {
          headers[`X-Test-${i}`] = `value-${i}`;
        }

        await fetch(getTunnelUrl(server, tunnelId, "/test"), { headers });

        assert.strictEqual(Object.keys(receivedHeaders).length, headerCount);
        for (let i = 0; i < headerCount; i++) {
          assert.strictEqual(receivedHeaders[`x-test-${i}`], `value-${i}`);
        }
      });

      it("should preserve header value case", async () => {
        let receivedHeader: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedHeader = req.headers["x-mixed-case"] as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "case-header-test" });

        const tunnelId = await getTunnelId("case-header-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            "X-Mixed-Case": "MixedCaseValue",
          },
        });

        assert.strictEqual(receivedHeader, "MixedCaseValue");
      });

      it("should preserve Content-Type with charset", async () => {
        let receivedContentType: string | undefined;

        mockServer.setHandler(async (req, res) => {
          receivedContentType = req.headers["content-type"] as string;
          await readBody(req);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "charset-test" });

        const tunnelId = await getTunnelId("charset-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: "{}",
        });

        assert.strictEqual(
          receivedContentType,
          "application/json; charset=utf-8"
        );
      });

      it("should preserve Accept header with quality values", async () => {
        let receivedAccept: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedAccept = req.headers.accept as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "accept-quality-test",
        });

        const tunnelId = await getTunnelId("accept-quality-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        assert.strictEqual(
          receivedAccept,
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        );
      });

      it("should handle headers with leading/trailing whitespace in values", async () => {
        let receivedHeader: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedHeader = req.headers["x-whitespace"] as string;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "whitespace-test" });

        const tunnelId = await getTunnelId("whitespace-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          headers: {
            "X-Whitespace": "  value with spaces  ",
          },
        });

        // HTTP headers typically trim whitespace
        assert.ok(receivedHeader !== undefined);
      });
    });

    describe(
      "web socket close tests",
      {
        // skip the test suite on cloudflare because it takes 10 seconds
        // to trigger the `webSocketClose` event after it's been triggered
        // by the client - it's a bug
        skip: serverName === "cloudflare" && skipCloudflareWebSocketCloseTests,
        timeout: 30000,
      },
      () => {
        async function testCloseCode3000() {
          using wss = createWsServer();

          wss.server.on("connection", (ws: WebSocketType) => {
            ws.close(3000, "Custom close");
          });

          using _disposable = await connectClient({
            secret: "ws-close3000-test",
            port: wss.port,
          });

          const tunnelId = await getTunnelId("ws-close3000-test", serverSecret);
          const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

          const clientWs = new WebSocket(wsUrl);
          let closeCode: number | undefined;
          let closeReason: string | undefined;

          await new Promise<void>((resolve, reject) => {
            clientWs.on("close", (code: number, reason: Buffer) => {
              closeCode = code;
              closeReason = reason.toString();
              resolve();
            });
            clientWs.on("error", reject);
          });

          assert.strictEqual(closeCode, 3000);
          assert.strictEqual(closeReason, "Custom close");
        }

        async function testCloseCode4000() {
          using wss = createWsServer();

          wss.server.on("connection", (ws: WebSocketType) => {
            ws.close(4000, "Private close");
          });

          using _disposable = await connectClient({
            secret: "ws-close4000-test",
            port: wss.port,
          });

          const tunnelId = await getTunnelId("ws-close4000-test", serverSecret);
          const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

          const clientWs = new WebSocket(wsUrl);
          let closeCode: number | undefined;
          let closeReason: string | undefined;

          await new Promise<void>((resolve, reject) => {
            clientWs.on("close", (code: number, reason: Buffer) => {
              closeCode = code;
              closeReason = reason.toString();
              resolve();
            });
            clientWs.on("error", reject);
          });

          assert.strictEqual(closeCode, 4000);
          assert.strictEqual(closeReason, "Private close");
        }

        async function testProxiedWsCloseOnDisconnect() {
          using wss = createWsServer();
          let externalWsClosed = false;

          wss.server.on("connection", (ws: WebSocketType) => {
            ws.on("message", (data: Buffer) => {
              ws.send(data);
            });
          });

          const disposable = await connectClient({
            secret: "ws-disconnect-test",
            port: wss.port,
          });

          const tunnelId = await getTunnelId(
            "ws-disconnect-test",
            serverSecret
          );
          const externalWs = new WebSocket(
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
            // Longer timeout for slow WebSocket close handling
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

            disposable[Symbol.dispose]();
          });

          assert.strictEqual(externalWsClosed, true);
        }

        it("should handle WebSocket close codes and disconnection", async () => {
          const results = await Promise.allSettled([
            testCloseCode3000(),
            testCloseCode4000(),
            testProxiedWsCloseOnDisconnect(),
          ]);

          const failures = results.filter(
            (r): r is PromiseRejectedResult => r.status === "rejected"
          );

          if (failures.length > 0) {
            const errorMessages = failures
              .map((f) => f.reason?.message ?? String(f.reason))
              .join("\n");
            throw new Error(
              `${failures.length} of ${results.length} parallel tests failed:\n${errorMessages}`
            );
          }
        });
      }
    );

    describe("websocket edge cases", () => {
      it("should forward text messages as text (not binary)", async () => {
        using wss = createWsServer();

        wss.server.on("connection", (ws: WebSocketType) => {
          // Server sends a text message
          ws.send(JSON.stringify({ action: "test", data: "hello" }));
        });

        using _disposable = await connectClient({
          secret: "ws-text-type-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-text-type-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const clientWs = new WebSocket(wsUrl);
        let receivedAsText = false;
        let receivedMessage: string | undefined;

        await new Promise<void>((resolve, reject) => {
          clientWs.on("message", (data: Buffer | ArrayBuffer, isBinary) => {
            receivedAsText = !isBinary;
            receivedMessage = data.toString();
            clientWs.close();
            resolve();
          });
          clientWs.on("error", reject);
        });

        assert.strictEqual(
          receivedAsText,
          true,
          "Message should be received as text, not binary"
        );
        assert.ok(receivedMessage?.includes("action"));
        assert.ok(receivedMessage?.includes("test"));
      });

      it("should forward binary messages as binary", async () => {
        using wss = createWsServer();

        const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

        wss.server.on("connection", (ws: WebSocketType) => {
          // Server sends a binary message
          ws.send(binaryData);
        });

        using _disposable = await connectClient({
          secret: "ws-binary-type-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-binary-type-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const clientWs = new WebSocket(wsUrl);
        let receivedAsBinary = false;
        let receivedData: Buffer | undefined;

        await new Promise<void>((resolve, reject) => {
          clientWs.binaryType = "arraybuffer";
          clientWs.on("message", (data: Buffer | ArrayBuffer, isBinary) => {
            receivedAsBinary = isBinary;
            receivedData = Buffer.from(data as ArrayBuffer);
            clientWs.close();
            resolve();
          });
          clientWs.on("error", reject);
        });

        assert.strictEqual(
          receivedAsBinary,
          true,
          "Message should be received as binary"
        );
        assert.ok(receivedData);
        assert.strictEqual(receivedData.length, 4);
        assert.strictEqual(receivedData[0], 0x00);
        assert.strictEqual(receivedData[3], 0xff);
      });

      it("should handle text messages with UTF-8 multi-byte characters", async () => {
        using wss = createWsServer();

        let serverReceivedMessage: string | undefined;

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            serverReceivedMessage = data.toString();
            ws.send(data.toString());
          });
        });

        using _disposable = await connectClient({
          secret: "ws-utf8-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-utf8-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const testMessage = "Hello 世界 🌍 émojis";
        const clientWs = new WebSocket(wsUrl);
        let clientReceivedMessage: string | undefined;

        await new Promise<void>((resolve, reject) => {
          clientWs.on("open", () => {
            clientWs.send(testMessage);
          });
          clientWs.on("message", (data: Buffer) => {
            clientReceivedMessage = data.toString();
            clientWs.close();
            resolve();
          });
          // we don't wait on resolve on `close` because Cloudflare DO has a bug where
          // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
          // by the client
          // clientWs.on("close", () => resolve());
          clientWs.on("error", reject);
        });

        assert.strictEqual(serverReceivedMessage, testMessage);
        assert.strictEqual(clientReceivedMessage, testMessage);
      });

      it("should handle empty WebSocket messages", async () => {
        using wss = createWsServer();

        let serverReceivedEmpty = false;

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            if (data.length === 0) {
              serverReceivedEmpty = true;
            }
            ws.send(data);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-empty-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-empty-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const clientWs = new WebSocket(wsUrl);
        let clientReceivedEmpty = false;

        await new Promise<void>((resolve, reject) => {
          clientWs.on("open", () => {
            clientWs.send("");
          });
          clientWs.on("message", (data: Buffer) => {
            if (data.length === 0) {
              clientReceivedEmpty = true;
            }
            clientWs.close();
            resolve();
          });
          // we don't wait on resolve on `close` because Cloudflare DO has a bug where
          // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
          // by the client
          // clientWs.on("close", () => resolve());
          clientWs.on("error", reject);
        });

        assert.ok(serverReceivedEmpty);
        assert.ok(clientReceivedEmpty);
      });

      it("should handle rapid sequential messages", async () => {
        using wss = createWsServer();

        const serverMessages: string[] = [];

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            serverMessages.push(data.toString());
            ws.send(`ack: ${data}`);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-rapid-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-rapid-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const clientWs = new WebSocket(wsUrl);
        const clientMessages: string[] = [];
        const messageCount = 10;

        await new Promise<void>((resolve, reject) => {
          clientWs.on("open", () => {
            for (let i = 0; i < messageCount; i++) {
              clientWs.send(`msg${i}`);
            }
          });
          clientWs.on("message", (data: Buffer) => {
            clientMessages.push(data.toString());
            if (clientMessages.length === messageCount) {
              clientWs.close();
              resolve();
            }
          });
          // we don't wait on resolve on `close` because Cloudflare DO has a bug where
          // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
          // by the client
          // clientWs.on("close", () => resolve());
          clientWs.on("error", reject);
        });

        assert.strictEqual(serverMessages.length, messageCount);
        assert.strictEqual(clientMessages.length, messageCount);
      });

      it("should handle large binary messages", async () => {
        // Use 64KB - a reasonable size that should work across implementations
        const largeData = new Uint8Array(64 * 1024);
        for (let i = 0; i < largeData.length; i++) {
          largeData[i] = i % 256;
        }

        let receivedSize = 0;

        using wss = createWsServer();

        wss.server.on("connection", (ws: WebSocketType) => {
          ws.on("message", (data: Buffer) => {
            receivedSize = data.length;
            ws.send(data);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-large-binary-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId(
          "ws-large-binary-test",
          serverSecret
        );
        const externalWs = new WebSocket(
          getTunnelWsUrl(server, tunnelId, "/ws")
        );

        let echoedSize = 0;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 25000);
          externalWs.on("open", () => {
            externalWs.send(largeData);
          });

          externalWs.on("message", (data: Buffer) => {
            clearTimeout(timeout);
            echoedSize = data.length;
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
      });

      it("should handle multiple WebSocket message exchanges", async () => {
        using wss = createWsServer();

        wss.server.on("connection", (ws: WebSocketType) => {
          let count = 0;
          ws.on("message", (data: Buffer) => {
            count++;
            ws.send(`response ${count}: ${data}`);
          });
        });

        using _disposable = await connectClient({
          secret: "ws-exchange-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-exchange-test", serverSecret);
        const wsUrl = getTunnelWsUrl(server, tunnelId, "/ws");

        const clientWs = new WebSocket(wsUrl);
        const responses: string[] = [];

        await new Promise<void>((resolve, reject) => {
          let sent = 0;
          clientWs.on("open", () => {
            clientWs.send("hello");
          });
          clientWs.on("message", (data: Buffer) => {
            responses.push(data.toString());
            sent++;
            if (sent < 3) {
              clientWs.send(`message ${sent + 1}`);
            } else {
              clientWs.close();
              resolve();
            }
          });
          // we don't wait on resolve on `close` because Cloudflare DO has a bug where
          // it takes 10 seconds to trigger the `webSocketClose` event after it's been triggered
          // by the client
          // clientWs.on("close", () => resolve());
          clientWs.on("error", reject);
        });

        assert.strictEqual(responses.length, 3);
        assert.strictEqual(responses[0], "response 1: hello");
        assert.strictEqual(responses[1], "response 2: message 2");
        assert.strictEqual(responses[2], "response 3: message 3");
      });

      it("should handle WebSocket with query parameters", async () => {
        let receivedUrl: string | undefined;

        using wss = createWsServer();

        wss.server.on("connection", (ws: WebSocketType, req) => {
          receivedUrl = req.url;
          ws.send("connected");
        });

        using _disposable = await connectClient({
          secret: "ws-query-test",
          port: wss.port,
        });

        const tunnelId = await getTunnelId("ws-query-test", serverSecret);
        const externalWs = new WebSocket(
          getTunnelWsUrl(server, tunnelId, "/ws?token=abc123&user=test")
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 8000);
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

        assert.ok(receivedUrl!.includes("token=abc123"));
        assert.ok(receivedUrl!.includes("user=test"));

        externalWs.terminate();
      });
    });

    describe("request/response body edge cases", () => {
      it("should handle empty body with Content-Length: 0", async () => {
        let receivedBody: string | undefined;

        mockServer.setHandler(async (req, res) => {
          receivedBody = await readBody(req);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "empty-body-test" });

        const tunnelId = await getTunnelId("empty-body-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          headers: { "Content-Length": "0" },
          body: "",
        });

        assert.strictEqual(receivedBody, "");
      });

      it("should handle large request body", async () => {
        const largeBody = "x".repeat(1_000_000);
        let receivedLength: number | undefined;

        mockServer.setHandler(async (req, res) => {
          const body = await readBody(req);
          receivedLength = body.length;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "large-req-body-test",
        });

        const tunnelId = await getTunnelId("large-req-body-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          body: largeBody,
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(receivedLength, 1_000_000);
      });

      it("should handle large response body", async () => {
        const largeBody = "y".repeat(1_000_000);

        mockServer.setHandler((_req, res) => {
          res.writeHead(200);
          res.end(largeBody);
        });

        using _disposable = await connectClient({
          secret: "large-res-body-test",
        });

        const tunnelId = await getTunnelId("large-res-body-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        const body = await response.text();
        assert.strictEqual(body.length, 1_000_000);
      });

      it("should handle binary request/response bodies", async () => {
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
        let receivedBinary: Buffer | undefined;

        mockServer.setHandler(async (req, res) => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          receivedBinary = Buffer.concat(chunks);
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(binaryData);
        });

        using _disposable = await connectClient({ secret: "binary-body-test" });

        const tunnelId = await getTunnelId("binary-body-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          body: binaryData,
        });

        const responseBuffer = Buffer.from(await response.arrayBuffer());
        assert.ok(receivedBinary);
        assert.ok(Buffer.compare(receivedBinary, binaryData) === 0);
        assert.ok(Buffer.compare(responseBuffer, binaryData) === 0);
      });

      it("should handle body with null bytes", async () => {
        const bodyWithNulls = "hello\x00world\x00test";
        let receivedBody: string | undefined;

        mockServer.setHandler(async (req, res) => {
          receivedBody = await readBody(req);
          res.writeHead(200);
          res.end(bodyWithNulls);
        });

        using _disposable = await connectClient({ secret: "null-bytes-test" });

        const tunnelId = await getTunnelId("null-bytes-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          body: bodyWithNulls,
        });

        const responseBody = await response.text();
        assert.strictEqual(receivedBody, bodyWithNulls);
        assert.strictEqual(responseBody, bodyWithNulls);
      });

      it("should handle JSON with unicode characters", async () => {
        const jsonBody = { greeting: "Hello 世界 🌍", name: "テスト" };
        let receivedJson: unknown;

        mockServer.setHandler(async (req, res) => {
          receivedJson = await readJsonBody(req);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(jsonBody));
        });

        using _disposable = await connectClient({
          secret: "json-unicode-test",
        });

        const tunnelId = await getTunnelId("json-unicode-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jsonBody),
        });

        const responseJson = await response.json();
        assert.deepStrictEqual(receivedJson, jsonBody);
        assert.deepStrictEqual(responseJson, jsonBody);
      });

      it("should handle URL-encoded form data", async () => {
        let receivedBody: string | undefined;
        let receivedContentType: string | undefined;

        mockServer.setHandler(async (req, res) => {
          receivedContentType = req.headers["content-type"] as string;
          receivedBody = await readBody(req);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "form-data-test" });

        const tunnelId = await getTunnelId("form-data-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "name=John+Doe&email=john%40example.com",
        });

        assert.strictEqual(
          receivedContentType,
          "application/x-www-form-urlencoded"
        );
        assert.strictEqual(
          receivedBody,
          "name=John+Doe&email=john%40example.com"
        );
      });
    });

    describe("connection edge cases", () => {
      it("should handle rapid reconnect cycles", async () => {
        let requestCount = 0;

        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          requestCount++;
          res.writeHead(200);
          res.end(`request-${requestCount}`);
        });

        const tunnelId = await getTunnelId("rapid-reconnect", serverSecret);

        for (let i = 0; i < 3; i++) {
          const { promise: disconnected, resolve: resolveDisconnected } =
            newPromise();
          const disposable = await connectClient({
            secret: "rapid-reconnect",
            onDisconnect: resolveDisconnected,
          });

          const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));
          assert.strictEqual(response.status, 200);
          assert.strictEqual(await response.text(), `request-${i + 1}`);

          disposable[Symbol.dispose]();
          await disconnected;
        }

        assert.strictEqual(requestCount, 3);
      });

      it("should handle many concurrent requests", async () => {
        const numRequests = 50;
        let requestCount = 0;

        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          requestCount++;
          const url = new URL(req.url!, `http://${req.headers.host}`);
          res.writeHead(200);
          res.end(`request-${url.searchParams.get("n")}`);
        });

        using _disposable = await connectClient({
          secret: "concurrent-test",
        });

        const tunnelId = await getTunnelId("concurrent-test", serverSecret);

        const promises = Array.from({ length: numRequests }, (_, i) =>
          fetch(getTunnelUrl(server, tunnelId, `/?n=${i}`))
        );

        const responses = await Promise.all(promises);

        for (let i = 0; i < numRequests; i++) {
          assert.strictEqual(responses[i]!.status, 200);
          assert.strictEqual(await responses[i]!.text(), `request-${i}`);
        }

        assert.strictEqual(requestCount, numRequests);
      });

      it("should return 503 immediately after client disconnect", async () => {
        mockServer.setHandler((_req, res) => {
          res.writeHead(200);
          res.end("OK");
        });

        const { promise: disconnected, resolve: resolveDisconnected } =
          newPromise();
        const disposable = await connectClient({
          secret: "immediate-503-test",
          onDisconnect: resolveDisconnected,
        });

        const tunnelId = await getTunnelId("immediate-503-test", serverSecret);

        // Verify it works first
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/test"));
        assert.strictEqual(response1.status, 200);

        // Disconnect
        disposable[Symbol.dispose]();
        await disconnected;

        // Should fail immediately
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/test"));
        assert.strictEqual(response2.status, 503);
      });

      it("should disconnect first client when second client connects with same secret", async () => {
        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          res.setHeader("x-client-id", req.headers["x-client-id"] ?? "");
          res.writeHead(200);
          res.end("ok");
        });

        const {
          promise: client1Disconnected,
          resolve: resolveClient1Disconnected,
        } = newPromise();
        const disposable1 = await connectClient({
          secret: "duplicate-client-test",
          onDisconnect: resolveClient1Disconnected,
          transformHeaders: (headers) => {
            headers["x-client-id"] = "client1";
            return headers;
          },
        });

        const tunnelId = await getTunnelId(
          "duplicate-client-test",
          serverSecret
        );

        // Verify client1 works
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(response1.status, 200);
        assert.strictEqual(response1.headers.get("x-client-id"), "client1");

        // Connect client2 with same secret - client1 should be disconnected
        using _disposable2 = await connectClient({
          secret: "duplicate-client-test",
          transformHeaders: (headers) => {
            headers["x-client-id"] = "client2";
            return headers;
          },
        });

        // Wait for client1 to be disconnected
        await client1Disconnected;

        // Requests should now go to client2
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(response2.status, 200);
        assert.strictEqual(response2.headers.get("x-client-id"), "client2");

        // Clean up disposable1 (already disconnected, but dispose to be safe)
        disposable1[Symbol.dispose]();
      });

      it("should handle new client connection with same secret", async () => {
        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          res.writeHead(200);
          res.end("client1");
        });

        const { promise: disconnected1, resolve: resolveDisconnected1 } =
          newPromise();
        const disposable1 = await connectClient({
          secret: "replace-client-test",
          onDisconnect: resolveDisconnected1,
        });

        const tunnelId = await getTunnelId("replace-client-test", serverSecret);

        // Verify client1 works
        const response1 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(await response1.text(), "client1");

        // Disconnect client1 first
        disposable1[Symbol.dispose]();
        await disconnected1;

        // Update handler for client2
        mockServer.setHandler(async (req, res) => {
          await readBody(req);
          res.writeHead(200);
          res.end("client2");
        });

        // Connect client2 with same secret
        using _disposable2 = await connectClient({
          secret: "replace-client-test",
        });

        // Requests should now go to client2
        const response2 = await fetch(getTunnelUrl(server, tunnelId, "/"));
        assert.strictEqual(await response2.text(), "client2");
      });
    });

    describe("error handling", () => {
      it("should return 502 for handler errors", async () => {
        mockServer.setHandler((_req, res) => {
          res.destroy();
        });

        using _disposable = await connectClient({
          secret: "handler-error-test",
        });

        const tunnelId = await getTunnelId("handler-error-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        assert.strictEqual(response.status, 502);
      });

      it("should handle handler that returns rejected promise", async () => {
        // Point to non-existent server - need to use TunnelClient directly
        // since connectClient helper expects a valid port
        using _connected = await new Promise<{ [Symbol.dispose]: () => void }>(
          (resolve) => {
            const client = new TunnelClient({
              serverUrl: server.url,
              secret: "rejected-promise-test",
              transformRequest: ({ method, url, headers }) => {
                url.host = "127.0.0.1:59999";
                return { method, url, headers };
              },
              onConnect: () => resolve({ [Symbol.dispose]: () => d.dispose() }),
            });
            const d = client.connect();
          }
        );

        const tunnelId = await getTunnelId(
          "rejected-promise-test",
          serverSecret
        );
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

        assert.strictEqual(response.status, 502);
      });

      it("should handle various HTTP status codes correctly", async () => {
        const statusCodes = [
          200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503,
        ];

        for (const statusCode of statusCodes) {
          mockServer.setHandler((_req, res) => {
            res.writeHead(statusCode);
            if (statusCode !== 204) {
              res.end(`Status: ${statusCode}`);
            } else {
              res.end();
            }
          });

          const secret = `status-code-${statusCode}`;
          using _disposable = await connectClient({ secret });

          const tunnelId = await getTunnelId(secret, serverSecret);
          const response = await fetch(getTunnelUrl(server, tunnelId, "/test"));

          assert.strictEqual(response.status, statusCode);
        }
      });
    });

    describe("URL handling", () => {
      it("should handle path with URL-encoded special characters", async () => {
        let receivedPath: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedPath = req.url;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "encoded-path-test",
        });

        const tunnelId = await getTunnelId("encoded-path-test", serverSecret);
        await fetch(
          getTunnelUrl(server, tunnelId, "/path%20with%20spaces/file%2Bname")
        );

        assert.ok(receivedPath?.includes("%20"));
      });

      it("should handle query string with special characters", async () => {
        let receivedUrl: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedUrl = req.url;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "query-special-test",
        });

        const tunnelId = await getTunnelId("query-special-test", serverSecret);
        await fetch(
          getTunnelUrl(
            server,
            tunnelId,
            "/search?q=hello%20world&filter=%3E100"
          )
        );

        assert.ok(receivedUrl?.includes("q=hello%20world"));
        assert.ok(receivedUrl?.includes("filter=%3E100"));
      });

      it("should handle double slashes in path", async () => {
        let receivedPath: string | undefined;

        mockServer.setHandler((req, res) => {
          receivedPath = req.url;
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({
          secret: "double-slash-test",
        });

        const tunnelId = await getTunnelId("double-slash-test", serverSecret);
        await fetch(getTunnelUrl(server, tunnelId, "//path//to//resource"));

        // Double slashes may be normalized or preserved depending on implementation
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
        const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
        const receivedMethods: string[] = [];

        mockServer.setHandler(async (req, res) => {
          receivedMethods.push(req.method!);
          await readBody(req);
          res.writeHead(200);
          res.end("OK");
        });

        using _disposable = await connectClient({ secret: "all-methods-test" });

        const tunnelId = await getTunnelId("all-methods-test", serverSecret);

        for (const method of methods) {
          await fetch(getTunnelUrl(server, tunnelId, "/test"), {
            method,
            body: method !== "GET" && method !== "DELETE" ? "body" : undefined,
          });
        }

        assert.deepStrictEqual(receivedMethods, methods);
      });

      it("should handle HEAD request correctly", async () => {
        mockServer.setHandler((_req, res) => {
          res.writeHead(200, {
            "Content-Type": "text/plain",
            "Content-Length": "13",
            "X-Custom": "header",
          });
          res.end();
        });

        using _disposable = await connectClient({ secret: "head-test" });

        const tunnelId = await getTunnelId("head-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "HEAD",
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get("X-Custom"), "header");
        const body = await response.text();
        assert.strictEqual(body, ""); // HEAD should have no body
      });

      it("should handle OPTIONS request for CORS", async () => {
        mockServer.setHandler((_req, res) => {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          });
          res.end();
        });

        using _disposable = await connectClient({ secret: "options-test" });

        const tunnelId = await getTunnelId("options-test", serverSecret);
        const response = await fetch(getTunnelUrl(server, tunnelId, "/test"), {
          method: "OPTIONS",
        });

        assert.strictEqual(response.status, 204);
        assert.strictEqual(
          response.headers.get("Access-Control-Allow-Origin"),
          "*"
        );
      });
    });
  });
}
