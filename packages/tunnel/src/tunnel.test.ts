/**
 * Tunnel test suite.
 *
 * This file runs the shared test suite against the local server implementation.
 * The same tests are also run against the Cloudflare server in cloudflare.test.ts.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { generateTunnelId, verifyTunnelId } from "./server/crypto";
import { createLocalServerFactory } from "./server/local.test-adapter";
import { runSharedTests } from "./shared.test-suite";

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
});
