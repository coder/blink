/**
 * Tunnel test suite.
 *
 * This file runs the shared test suite against the local server implementation.
 * The same tests are also run against the Cloudflare server in cloudflare.test.ts.
 */

import assert from "node:assert";
import { after, describe, it } from "node:test";
import { WebSocketServer, type WebSocket as WebSocketType } from "ws";
import { TunnelClient } from "./client";
import type { ConnectionEstablished } from "./schema";
import { generateTunnelId, verifyTunnelId } from "./server/crypto";
import { createLocalServerFactory } from "./server/local.test-adapter";
import { runSharedTests } from "./shared.test-suite";
import { newPromise } from "./test-utils";

const SERVER_SECRET = "test-server-secret";
const CLIENT_SECRET = "test-client-secret";

describe("tunnel", () => {
  // Crypto tests are standalone - they don't need a server
  describe("crypto", () => {
    it("should generate consistent tunnel IDs", async () => {
      const id1 = await generateTunnelId(CLIENT_SECRET, SERVER_SECRET);
      const id2 = await generateTunnelId(CLIENT_SECRET, SERVER_SECRET);

      assert.strictEqual(id1, id2);
      assert.strictEqual(id1.length, 16);
      assert.match(id1, /^[0-9a-z]+$/);
    });

    it("should generate different IDs for different client secrets", async () => {
      const id1 = await generateTunnelId("secret1", SERVER_SECRET);
      const id2 = await generateTunnelId("secret2", SERVER_SECRET);

      assert.notStrictEqual(id1, id2);
    });

    it("should generate different IDs for different server secrets", async () => {
      const id1 = await generateTunnelId(CLIENT_SECRET, "server1");
      const id2 = await generateTunnelId(CLIENT_SECRET, "server2");

      assert.notStrictEqual(id1, id2);
    });

    it("should verify tunnel IDs correctly", async () => {
      const id = await generateTunnelId(CLIENT_SECRET, SERVER_SECRET);

      const isValid = await verifyTunnelId(id, CLIENT_SECRET, SERVER_SECRET);
      assert.strictEqual(isValid, true);

      const isInvalid = await verifyTunnelId(id, "wrong-secret", SERVER_SECRET);
      assert.strictEqual(isInvalid, false);
    });

    it("should handle empty secrets", async () => {
      const id = await generateTunnelId("", SERVER_SECRET);
      assert.strictEqual(id.length, 16);
      assert.match(id, /^[0-9a-z]+$/);
    });

    it("should handle unicode secrets", async () => {
      const id = await generateTunnelId("секрет🔐", SERVER_SECRET);
      assert.strictEqual(id.length, 16);
      assert.match(id, /^[0-9a-z]+$/);
    });

    it("should use full base36 alphabet for maximum entropy", async () => {
      const ids = new Set<string>();
      const allChars = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const id = await generateTunnelId(`secret-${i}`, SERVER_SECRET);
        ids.add(id);
        for (const char of id) {
          allChars.add(char);
        }
      }

      assert.strictEqual(ids.size, 100);
      const beyondHex = [...allChars].filter((c) => c >= "g" && c <= "z");
      assert.ok(beyondHex.length > 0);
    });
  });

  // Run shared tests against local server
  runSharedTests(
    "local",
    createLocalServerFactory(SERVER_SECRET),
    SERVER_SECRET
  );

  // Ping/pong tests that require a custom mock server
  describe("ping/pong reconnection", () => {
    it("should reconnect when server does not respond to pings", async () => {
      // Create a minimal HTTP + WebSocket server that acts like a tunnel server
      // but does NOT respond to pings (simulating a dead connection)
      const http = await import("node:http");
      const httpServer = http.createServer();
      const wss = new WebSocketServer({ noServer: true });

      // Handle WebSocket upgrade on /api/tunnel/connect path
      httpServer.on("upgrade", (request, socket, head) => {
        if (request.url === "/api/tunnel/connect") {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        } else {
          socket.destroy();
        }
      });

      await new Promise<void>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => resolve());
      });

      const address = httpServer.address() as { port: number };
      const port = address.port;
      const serverUrl = `http://127.0.0.1:${port}`;

      let connectionCount = 0;

      wss.on("connection", (ws: WebSocketType) => {
        connectionCount++;

        // Send ConnectionEstablished message like a real tunnel server
        const connectionInfo: ConnectionEstablished = {
          url: `${serverUrl}/tunnel/test123`,
          id: "test123",
        };
        ws.send(JSON.stringify(connectionInfo));

        // On first connection only, terminate when ping is received
        // This simulates a dead connection where the server dies
        if (connectionCount === 1) {
          ws.once("ping", () => {
            // Terminate abruptly without sending pong
            ws.terminate();
          });
        }
        // On subsequent connections, normal behavior (pong is auto-sent)
      });

      after(() => {
        wss.close();
        httpServer.close();
      });

      // Track connection events
      let connectCount = 0;
      let disconnectCount = 0;

      const { promise: reconnected, resolve: resolveReconnected } =
        newPromise();

      const client = new TunnelClient({
        serverUrl,
        secret: "test-secret",
        transformRequest: ({ method, url, headers }) => {
          return { method, url, headers };
        },
        pingIntervalMs: 50, // Very short for testing
        pongTimeoutMs: 50, // Very short for testing
        onConnect: () => {
          connectCount++;
          if (connectCount >= 2) {
            resolveReconnected();
          }
        },
        onDisconnect: () => {
          disconnectCount++;
        },
      });

      const disposable = client.connect();

      // Wait for reconnection to happen
      await Promise.race([
        reconnected,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Timed out waiting for reconnection")),
            5000
          )
        ),
      ]);

      disposable.dispose();

      // Verify reconnection happened
      assert.ok(
        connectCount >= 2,
        `Expected at least 2 connections, got ${connectCount}`
      );
      assert.ok(
        disconnectCount >= 1,
        `Expected at least 1 disconnection, got ${disconnectCount}`
      );

      // Verify the server saw multiple connections
      assert.ok(
        connectionCount >= 2,
        `Server expected at least 2 connections, got ${connectionCount}`
      );
    });
  });
});
