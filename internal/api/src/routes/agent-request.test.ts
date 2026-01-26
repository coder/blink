import { describe, expect, test } from "bun:test";
import type { Agent } from "@blink.so/database/schema";
import type { Server } from "bun";
import { serve } from "../test";

interface SetupAgentOptions {
  name: string;
  handler: (req: Request) => Response | Promise<Response>;
  /** If provided, sets up slack_verification on the agent */
  slackVerification?: {
    signingSecret: string;
    botToken: string;
    /** Custom expiresAt timestamp (defaults to 24h from now) */
    expiresAt?: string;
  };
}

interface SetupAgentResult extends Disposable {
  /** The agent ID */
  agentId: string;
  /** Subpath webhook URL (/api/webhook/:id) - cookies are stripped */
  webhookUrl: string;
  getWebhookUrl: (subpath?: string) => string;
  /** Fetch via subdomain (uses Host header) - cookies pass through */
  fetchSubdomain: (path?: string, init?: RequestInit) => Promise<Response>;
  /** Get the current agent from the database */
  getAgent: () => Promise<Agent | undefined>;
}

async function setupAgent(
  options: SetupAgentOptions
): Promise<SetupAgentResult> {
  let deployedPromise: Promise<void> | undefined;
  let mockServer: Server | undefined;
  let requestId: string | undefined;

  const {
    bindings,
    helpers,
    url: apiUrl,
  } = await serve({
    bindings: {
      async deployAgent(deployment): Promise<void> {
        deployedPromise = (async () => {
          mockServer = Bun.serve({
            fetch: options.handler,
            port: 0,
          });

          const db = await bindings.database();
          await db.updateAgentDeployment({
            id: deployment.id,
            agent_id: deployment.agent_id,
            status: "success",
            direct_access_url: mockServer.url.toString(),
          });
          await db.updateAgent({
            id: deployment.agent_id,
            active_deployment_id: deployment.id,
          });
        })();
      },
      matchRequestHost: (host: string) => {
        // Match subdomain pattern: {request_id}.localhost:port
        const match = host.match(/^([^.]+)\./);
        if (match && requestId && match[1] === requestId) {
          return requestId;
        }
        return undefined;
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: `${options.name}-org`,
  });
  const agent = await client.agents.create({
    organization_id: org.id,
    name: `${options.name}-agent`,
    visibility: "public",
    output_files: [{ path: "test.js", data: "console.log('test');" }],
  });

  if (deployedPromise) await deployedPromise;
  if (!agent.request_url) throw new Error("No webhook route");

  const db = await bindings.database();

  // Set up slack verification if provided
  if (options.slackVerification) {
    const now = new Date();
    const defaultExpiresAt = new Date(
      now.getTime() + 24 * 60 * 60 * 1000
    ).toISOString();
    await db.updateAgent({
      id: agent.id,
      slack_verification: {
        signingSecret: options.slackVerification.signingSecret,
        botToken: options.slackVerification.botToken,
        startedAt: now.toISOString(),
        expiresAt: options.slackVerification.expiresAt ?? defaultExpiresAt,
      },
    });
  }

  const target = await db.selectAgentDeploymentTargetByName(
    agent.id,
    "production"
  );
  if (!target) throw new Error("No deployment target");
  requestId = target.request_id;

  const parsedApiUrl = new URL(apiUrl);
  const subdomainHost = `${requestId}.${parsedApiUrl.host}`;

  return {
    agentId: agent.id,
    webhookUrl: `${apiUrl}/api/webhook/${target.request_id}`,
    getWebhookUrl: (subpath?: string) =>
      `${apiUrl}/api/webhook/${target.request_id}${subpath || ""}`,
    fetchSubdomain: (path?: string, init?: RequestInit) => {
      // Make request to API server with Host header set to subdomain
      // This simulates subdomain routing without needing DNS resolution
      const headers = new Headers(init?.headers);
      headers.set("host", subdomainHost);
      return fetch(`${apiUrl}${path || "/"}`, { ...init, headers });
    },
    getAgent: () => db.selectAgentByID(agent.id),
    [Symbol.dispose]: () => mockServer?.stop(),
  };
}

describe("webhook requests (/api/webhook/:id)", () => {
  test("basic request", async () => {
    using agent = await setupAgent({
      name: "basic",
      handler: () => new Response("Hello, world!"),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello, world!");
  });

  test("proxies subpaths", async () => {
    let receivedPath: string | undefined;

    using agent = await setupAgent({
      name: "subpath",
      handler: (req) => {
        receivedPath = new URL(req.url).pathname;
        return new Response(`Path: ${receivedPath}`);
      },
    });

    const response = await fetch(agent.getWebhookUrl("/github/events"));
    expect(response.status).toBe(200);
    expect(receivedPath).toBe("/github/events");
  });

  test("strips cookies from requests", async () => {
    let receivedCookieHeader: string | null | undefined;

    using agent = await setupAgent({
      name: "cookies",
      handler: (req) => {
        receivedCookieHeader = req.headers.get("cookie");
        return new Response("OK");
      },
    });

    const response = await fetch(agent.webhookUrl, {
      headers: { cookie: "session=secret-token; other=value" },
    });
    expect(response.status).toBe(200);
    expect(receivedCookieHeader).toBeNull();
  });

  test("strips set-cookie from responses", async () => {
    using agent = await setupAgent({
      name: "setcookie",
      handler: () =>
        new Response("OK", {
          headers: {
            "set-cookie": "malicious=hijack; Path=/; HttpOnly",
            "x-custom-header": "should-pass-through",
          },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-custom-header")).toBe("should-pass-through");
  });

  test("strips CORS headers from responses", async () => {
    using agent = await setupAgent({
      name: "cors",
      handler: () =>
        new Response("OK", {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": "GET, POST, PUT, DELETE",
            "access-control-allow-headers": "Content-Type, Authorization",
            "x-custom-header": "should-pass-through",
          },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("access-control-allow-headers")).toBeNull();
    expect(response.headers.get("x-custom-header")).toBe("should-pass-through");
  });

  test("filters CORS values from Vary header", async () => {
    using agent = await setupAgent({
      name: "vary",
      handler: () =>
        new Response("OK", {
          headers: {
            vary: "Origin, Accept-Encoding, Access-Control-Request-Method, Access-Control-Request-Headers",
          },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    // Note: API's CORS middleware may add "Origin" back to Vary
    // The important thing is that Access-Control-Request-* values are filtered
    const vary = response.headers.get("vary");
    expect(vary).toContain("Accept-Encoding");
    expect(vary?.toLowerCase()).not.toContain("access-control-request-method");
    expect(vary?.toLowerCase()).not.toContain("access-control-request-headers");
  });

  test("removes agent CORS values from Vary header", async () => {
    using agent = await setupAgent({
      name: "vary-only-cors",
      handler: () =>
        new Response("OK", {
          headers: {
            vary: "Access-Control-Request-Method, Access-Control-Request-Headers",
          },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    // Agent's CORS Vary values should be removed
    // API's CORS middleware may add "Origin" which is fine
    const vary = response.headers.get("vary");
    if (vary) {
      expect(vary.toLowerCase()).not.toContain("access-control-request-method");
      expect(vary.toLowerCase()).not.toContain(
        "access-control-request-headers"
      );
    }
  });

  test("strips uppercase Set-Cookie header", async () => {
    using agent = await setupAgent({
      name: "uppercase-setcookie",
      handler: () =>
        new Response("OK", {
          headers: [["Set-Cookie", "malicious=hijack; Path=/; HttpOnly"]],
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("strips uppercase CORS headers", async () => {
    using agent = await setupAgent({
      name: "uppercase-cors",
      handler: () =>
        new Response("OK", {
          headers: [
            ["ACCESS-CONTROL-ALLOW-ORIGIN", "*"],
            ["ACCESS-CONTROL-ALLOW-CREDENTIALS", "true"],
            ["ACCESS-CONTROL-ALLOW-METHODS", "GET, POST"],
            ["ACCESS-CONTROL-ALLOW-HEADERS", "Content-Type"],
          ],
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("ACCESS-CONTROL-ALLOW-ORIGIN")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("access-control-allow-headers")).toBeNull();
  });

  test("filters uppercase CORS values from Vary header", async () => {
    using agent = await setupAgent({
      name: "uppercase-vary",
      handler: () =>
        new Response("OK", {
          headers: [
            [
              "VARY",
              "ORIGIN, Accept-Encoding, ACCESS-CONTROL-REQUEST-METHOD, ACCESS-CONTROL-REQUEST-HEADERS",
            ],
          ],
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    const vary = response.headers.get("vary");
    expect(vary).toContain("Accept-Encoding");
    expect(vary?.toLowerCase()).not.toContain("access-control-request-method");
    expect(vary?.toLowerCase()).not.toContain("ACCESS-CONTROL-REQUEST-METHOD");
    expect(vary?.toLowerCase()).not.toContain("access-control-request-headers");
  });

  test("adds X-Content-Type-Options: nosniff to prevent MIME sniffing", async () => {
    using agent = await setupAgent({
      name: "nosniff",
      handler: () =>
        new Response("<script>alert('xss')</script>", {
          headers: { "content-type": "text/html" },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("adds restrictive Content-Security-Policy header", async () => {
    using agent = await setupAgent({
      name: "csp",
      handler: () =>
        new Response("<script>alert('xss')</script>", {
          headers: { "content-type": "text/html" },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("adds X-Frame-Options: DENY to prevent clickjacking", async () => {
    using agent = await setupAgent({
      name: "xfo",
      handler: () => new Response("OK"),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("strips Location header to prevent open redirects", async () => {
    using agent = await setupAgent({
      name: "redirect",
      handler: () =>
        new Response("Redirecting...", {
          status: 200,
          headers: {
            location: "https://evil.com/phishing",
            "x-custom": "preserved",
          },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    // Location header should be stripped to prevent open redirects
    expect(response.headers.get("location")).toBeNull();
    // Other headers should be preserved
    expect(response.headers.get("x-custom")).toBe("preserved");
  });

  test("overrides malicious security headers from agent", async () => {
    using agent = await setupAgent({
      name: "malicious-headers",
      handler: () =>
        new Response("OK", {
          headers: {
            "x-content-type-options": "unsafe",
            "content-security-policy": "default-src *",
            "x-frame-options": "ALLOWALL",
          },
        }),
    });

    const response = await fetch(agent.webhookUrl);
    expect(response.status).toBe(200);
    // Our security headers should override malicious ones
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("proxies chunked webhook bodies to the agent", async () => {
    const payload = JSON.stringify({
      type: "event_callback",
      event: { type: "message", text: "streamed hello" },
    });
    const splitIndex = Math.ceil(payload.length / 2);
    const chunks = [payload.slice(0, splitIndex), payload.slice(splitIndex)];
    const encoder = new TextEncoder();
    let chunkIndex = 0;

    const bodyStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunkIndex >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex += 1;
      },
    });

    let receivedBody: string | undefined;

    using agent = await setupAgent({
      name: "slack-streaming",
      handler: async (req) => {
        receivedBody = await req.text();
        return new Response("OK");
      },
    });

    const response = await fetch(agent.getWebhookUrl("/"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: bodyStream,
    });

    const responseText = await response.text();
    expect(response.status).toBe(200);
    expect(responseText).toBe("OK");
    expect(receivedBody).toBe(payload);
  });
});

describe("Slack request Content-Length handling", () => {
  test("recalculates Content-Length when body is read as text for Slack verification", async () => {
    // Body with multi-byte UTF-8 characters
    // "Hello 世界" is 6 ASCII chars (6 bytes) + 1 space (1 byte) + 2 Chinese chars (6 bytes) = 13 bytes
    const bodyWithMultiByteChars = JSON.stringify({
      type: "event_callback",
      event: { type: "message", text: "Hello 世界" },
    });
    const expectedByteLength = new TextEncoder().encode(
      bodyWithMultiByteChars
    ).length;

    let receivedContentLength: string | null | undefined;
    let receivedBodyLength: number | undefined;

    using agent = await setupAgent({
      name: "slack-content-length",
      handler: async (req) => {
        receivedContentLength = req.headers.get("content-length");
        const body = await req.text();
        receivedBodyLength = new TextEncoder().encode(body).length;
        return new Response("OK");
      },
      slackVerification: {
        signingSecret: "test-secret",
        botToken: "xoxb-test-token",
      },
    });

    // Send request with a Content-Length that would be wrong if we used string length
    // instead of byte length (string length is different from byte length for multi-byte chars)
    const response = await fetch(agent.getWebhookUrl("/slack"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Intentionally set a wrong Content-Length to verify it gets corrected
        "content-length": String(bodyWithMultiByteChars.length),
      },
      body: bodyWithMultiByteChars,
    });

    // The request should succeed (we won't have valid Slack signature, but that's OK for this test)
    // What we're testing is that the Content-Length was recalculated correctly
    expect(response.status).toBe(200);

    // Verify the Content-Length header received by the agent matches actual byte length
    expect(receivedContentLength).toBe(String(expectedByteLength));
    expect(receivedBodyLength).toBe(expectedByteLength);
  });
});

describe("subdomain requests", () => {
  test("basic request", async () => {
    using agent = await setupAgent({
      name: "subdomain-basic",
      handler: () => new Response("Hello from subdomain!"),
    });

    const response = await agent.fetchSubdomain();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello from subdomain!");
  });

  test("preserves path", async () => {
    let receivedPath: string | undefined;

    using agent = await setupAgent({
      name: "subdomain-path",
      handler: (req) => {
        receivedPath = new URL(req.url).pathname;
        return new Response(`Path: ${receivedPath}`);
      },
    });

    const response = await agent.fetchSubdomain("/api/data");
    expect(response.status).toBe(200);
    expect(receivedPath).toBe("/api/data");
  });

  test("passes cookies through", async () => {
    let receivedCookieHeader: string | null | undefined;

    using agent = await setupAgent({
      name: "subdomain-cookies",
      handler: (req) => {
        receivedCookieHeader = req.headers.get("cookie");
        return new Response("OK");
      },
    });

    const response = await agent.fetchSubdomain("/", {
      headers: { cookie: "session=secret-token; other=value" },
    });
    expect(response.status).toBe(200);
    expect(receivedCookieHeader).toBe("session=secret-token; other=value");
  });

  test("passes set-cookie through", async () => {
    using agent = await setupAgent({
      name: "subdomain-setcookie",
      handler: () =>
        new Response("OK", {
          headers: {
            "set-cookie": "agent-cookie=value; Path=/; HttpOnly",
            "x-custom-header": "should-pass-through",
          },
        }),
    });

    const response = await agent.fetchSubdomain();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(
      "agent-cookie=value; Path=/; HttpOnly"
    );
    expect(response.headers.get("x-custom-header")).toBe("should-pass-through");
  });

  test("passes CORS headers through", async () => {
    using agent = await setupAgent({
      name: "subdomain-cors",
      handler: () =>
        new Response("OK", {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": "GET, POST",
            "access-control-allow-headers": "Content-Type",
            vary: "Origin, Accept-Encoding",
          },
        }),
    });

    const response = await agent.fetchSubdomain();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true"
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST"
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type"
    );
    expect(response.headers.get("vary")).toBe("Origin, Accept-Encoding");
  });
});

describe("Slack verification expiration", () => {
  test("clears expired slack_verification and skips verification processing", async () => {
    // Set expiresAt to 1 hour ago (already expired)
    const expiredAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    let handlerCalled = false;

    using agent = await setupAgent({
      name: "slack-expired",
      handler: () => {
        handlerCalled = true;
        return new Response("OK");
      },
      slackVerification: {
        signingSecret: "test-secret",
        botToken: "xoxb-test-token",
        expiresAt: expiredAt,
      },
    });

    // Verify slack_verification is set before request
    const beforeAgent = await agent.getAgent();
    expect(beforeAgent?.slack_verification).not.toBeNull();

    // Make a request to /slack path
    const response = await fetch(agent.getWebhookUrl("/slack"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "event_callback", event: { type: "test" } }),
    });

    expect(response.status).toBe(200);
    expect(handlerCalled).toBe(true);

    // Verify slack_verification was cleared
    const afterAgent = await agent.getAgent();
    expect(afterAgent?.slack_verification).toBeNull();
  });

  test("does not clear non-expired slack_verification", async () => {
    // Set expiresAt to 1 hour from now (not expired yet)
    const futureExpiresAt = new Date(
      Date.now() + 1 * 60 * 60 * 1000
    ).toISOString();

    using agent = await setupAgent({
      name: "slack-not-expired",
      handler: () => new Response("OK"),
      slackVerification: {
        signingSecret: "test-secret",
        botToken: "xoxb-test-token",
        expiresAt: futureExpiresAt,
      },
    });

    // Verify slack_verification is set before request
    const beforeAgent = await agent.getAgent();
    expect(beforeAgent?.slack_verification).not.toBeNull();

    // Make a request to /slack path
    const response = await fetch(agent.getWebhookUrl("/slack"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "event_callback", event: { type: "test" } }),
    });

    expect(response.status).toBe(200);

    // Verify slack_verification was NOT cleared (still active)
    const afterAgent = await agent.getAgent();
    expect(afterAgent?.slack_verification).not.toBeNull();
  });

  test("does not run verification logic for expired slack_verification on non-slack paths", async () => {
    // Set expiresAt to 1 hour ago (already expired)
    const expiredAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    using agent = await setupAgent({
      name: "slack-expired-non-slack-path",
      handler: () => new Response("OK"),
      slackVerification: {
        signingSecret: "test-secret",
        botToken: "xoxb-test-token",
        expiresAt: expiredAt,
      },
    });

    // Verify slack_verification is set before request
    const beforeAgent = await agent.getAgent();
    expect(beforeAgent?.slack_verification).not.toBeNull();

    // Make a request to a non-slack path (e.g., /github)
    const response = await fetch(agent.getWebhookUrl("/github"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "push" }),
    });

    expect(response.status).toBe(200);

    // slack_verification should NOT be cleared for non-slack paths
    // (expiration check only runs for /slack requests)
    const afterAgent = await agent.getAgent();
    expect(afterAgent?.slack_verification).not.toBeNull();
  });
});
