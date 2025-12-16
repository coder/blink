/**
 * Devhook test suite.
 *
 * This file runs the shared test suite against the local server implementation.
 * The same tests are also run against the Cloudflare server in cloudflare.test.ts.
 */

import { describe, it, expect } from "vitest";
import { generateDevhookId, verifyDevhookId } from "./server/crypto";
import { createLocalServerFactory } from "./server/local.test-adapter";
import { runSharedTests } from "./shared.test-suite";

const SERVER_SECRET = "test-server-secret";
const CLIENT_SECRET = "test-client-secret";

describe("devhook", () => {
  // Crypto tests are standalone - they don't need a server
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

      const isInvalid = await verifyDevhookId(
        id,
        "wrong-secret",
        SERVER_SECRET
      );
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
      const ids = new Set<string>();
      const allChars = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const id = await generateDevhookId(`secret-${i}`, SERVER_SECRET);
        ids.add(id);
        for (const char of id) {
          allChars.add(char);
        }
      }

      expect(ids.size).toBe(100);
      const beyondHex = [...allChars].filter((c) => c >= "g" && c <= "z");
      expect(beyondHex.length).toBeGreaterThan(0);
    });
  });

  // Run shared tests against local server
  runSharedTests(
    "local",
    createLocalServerFactory(SERVER_SECRET),
    SERVER_SECRET
  );
});
