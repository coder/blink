import { runAsNodeTest } from "../../../scripts/runAsNodeTest";
import { createCloudflareServerFactory } from "./server/cloudflare.test-adapter";
import { runSharedTests } from "./shared.test-suite";

const SERVER_SECRET = "test-server-secret";

if (typeof Bun !== "undefined") {
  runAsNodeTest("cloudflare", __filename, { timeoutMs: 180_000 });
} else {
  // Run the shared test suite against the Cloudflare worker
  // This ensures both local and Cloudflare servers pass the same tests
  runSharedTests(
    "cloudflare",
    createCloudflareServerFactory(SERVER_SECRET),
    SERVER_SECRET,
    {
      skipCloudflareWebSocketCloseTests:
        process.env.ENABLE_CLOUDFLARE_WEBSOCKET_CLOSE_TESTS === undefined &&
        // always run the tests in CI
        process.env.CI === undefined,
    }
  );
}
