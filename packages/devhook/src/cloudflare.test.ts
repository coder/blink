/**
 * Cloudflare server test suite.
 *
 * This file runs the shared test suite against the Cloudflare Worker implementation
 * using wrangler's unstable_dev API for local testing.
 *
 * IMPORTANT: These tests require wrangler and its dependencies to work properly.
 * They may be skipped in CI if wrangler isn't available.
 *
 * Run with: bun run test:cloudflare
 * Or with explicit enable: ENABLE_CLOUDFLARE_TESTS=1 bun run test:cloudflare
 *
 * NOTE: WebSocket proxying tests are skipped in local mode because miniflare's
 * WebSocket implementation has some differences from production Cloudflare.
 * The HTTP tests are the primary concern for API compatibility.
 */

import { describe, it, expect } from "vitest";
import { createCloudflareServerFactory } from "./server/cloudflare.test-adapter";
import { runSharedTests } from "./shared.test-suite";

const SERVER_SECRET = "test-server-secret";

// Check if we should skip tests (e.g., in CI without wrangler)
const SKIP_TESTS = process.env.SKIP_CLOUDFLARE_TESTS === "1";

if (SKIP_TESTS) {
  describe("devhook cloudflare (skipped)", () => {
    it("cloudflare tests are skipped - set SKIP_CLOUDFLARE_TESTS=0 to enable", () => {
      expect(true).toBe(true);
    });
  });
} else {
  // Run the shared test suite against the Cloudflare worker
  // This ensures both local and Cloudflare servers pass the same tests
  runSharedTests(
    "cloudflare",
    createCloudflareServerFactory(SERVER_SECRET),
    SERVER_SECRET
  );
}
