/**
 * Cloudflare Worker entry point for the devhook server.
 *
 * This worker handles:
 * 1. Client connections at /api/devhook/connect
 * 2. Proxy requests via wildcard subdomains (*.example.com)
 * 3. Proxy requests via subpath routing (/devhook/:id/*)
 */

import { generateDevhookId } from "./crypto";
import type { DevhookSession, DevhookSessionEnv } from "./durable-object";

export interface Env extends DevhookSessionEnv {
  DEVHOOK_SESSION: DurableObjectNamespace<DevhookSession>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle client connection requests
    if (url.pathname === "/api/devhook/connect") {
      return handleClientConnect(request, env);
    }

    // Handle proxy requests
    const devhookId = extractDevhookId(url, env);
    if (devhookId) {
      return handleProxyRequest(request, env, devhookId);
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        error: "Not found",
        message: "This endpoint does not exist.",
      }),
      {
        status: 404,
        headers: { "content-type": "application/json" },
      }
    );
  },
};

/**
 * Handle a client connecting to establish a devhook.
 */
async function handleClientConnect(request: Request, env: Env): Promise<Response> {
  // Verify WebSocket upgrade
  if (request.headers.get("upgrade") !== "websocket") {
    return new Response(
      JSON.stringify({
        error: "WebSocket required",
        message: "This endpoint requires a WebSocket connection.",
      }),
      {
        status: 426,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Get client secret from header
  const clientSecret = request.headers.get("x-devhook-secret");
  if (!clientSecret) {
    return new Response(
      JSON.stringify({
        error: "Missing secret",
        message: "The x-devhook-secret header is required.",
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Generate the devhook ID from the client secret
  const devhookId = await generateDevhookId(clientSecret, env.DEVHOOK_SECRET);

  // Get or create the Durable Object for this session
  const sessionId = env.DEVHOOK_SESSION.idFromName(devhookId);
  const session = env.DEVHOOK_SESSION.get(sessionId) as unknown as DevhookSession;

  // Initialize the session if needed
  const existingSecret = session.getClientSecret();
  if (!existingSecret) {
    await session.initialize(devhookId, clientSecret);
  } else if (existingSecret !== clientSecret) {
    // This shouldn't happen due to HMAC, but verify anyway
    return new Response(
      JSON.stringify({
        error: "Invalid secret",
        message: "The provided secret does not match the existing session.",
      }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Forward to the Durable Object
  return session.fetch(request);
}

/**
 * Extract the devhook ID from the request URL.
 * Supports both wildcard subdomain and subpath modes.
 */
function extractDevhookId(url: URL, env: Env): string | undefined {
  const mode = env.DEVHOOK_MODE || "wildcard";
  const baseUrl = new URL(env.DEVHOOK_BASE_URL);

  if (mode === "subpath") {
    // Subpath mode: /devhook/:id/*
    const match = url.pathname.match(/^\/devhook\/([a-f0-9]{16})(\/.*)?$/);
    if (match) {
      return match[1];
    }
  } else {
    // Wildcard mode: :id.example.com
    const baseHost = baseUrl.hostname;
    if (url.hostname.endsWith(`.${baseHost}`) && url.hostname !== baseHost) {
      const subdomain = url.hostname.slice(0, -(baseHost.length + 1));
      // Validate it looks like a devhook ID (16 hex characters)
      if (/^[a-f0-9]{16}$/.test(subdomain)) {
        return subdomain;
      }
    }
  }

  return undefined;
}

/**
 * Handle a proxy request to a devhook.
 */
async function handleProxyRequest(
  request: Request,
  env: Env,
  devhookId: string
): Promise<Response> {
  const sessionId = env.DEVHOOK_SESSION.idFromName(devhookId);
  const session = env.DEVHOOK_SESSION.get(sessionId) as unknown as DevhookSession;

  // Build the proxy URL
  const url = new URL(request.url);
  const mode = env.DEVHOOK_MODE || "wildcard";

  let proxyPath: string;
  if (mode === "subpath") {
    // Remove the /devhook/:id prefix
    proxyPath = url.pathname.replace(/^\/devhook\/[a-z0-9]+/, "") || "/";
  } else {
    proxyPath = url.pathname;
  }

  // Construct the full proxy URL (preserving query string)
  const proxyUrl = new URL(proxyPath + url.search, url.origin);

  // Forward to the Durable Object with the proxy URL header
  const headers = new Headers(request.headers);
  headers.set("x-devhook-proxy-url", proxyUrl.toString());

  return session.fetch(
    new Request("https://devhook/proxy", {
      method: request.method,
      headers,
      body: request.body,
    })
  );
}

// Re-export the Durable Object for wrangler
export { DevhookSession } from "./durable-object";
