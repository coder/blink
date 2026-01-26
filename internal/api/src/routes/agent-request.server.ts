import { BlinkInvocationTokenHeader } from "@blink.so/runtime/types";
import type { Context } from "hono";

import type { Bindings } from "../server";
import { detectRequestLocation } from "../server-helper";
import { generateAgentInvocationToken } from "./agents/me/me.server";
import { handleSlackWebhook, isSlackRequest } from "./agents/slack-webhook";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const stripHopByHopHeaders = (headers: Headers): Headers => {
  const connectionTokens = new Set<string>();
  headers.forEach((value, key) => {
    if (key.toLowerCase() !== "connection") {
      return;
    }
    for (const token of value.split(",")) {
      const trimmed = token.trim().toLowerCase();
      if (trimmed) {
        connectionTokens.add(trimmed);
      }
    }
  });

  const sanitized = new Headers();
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || connectionTokens.has(lowerKey)) {
      return;
    }
    sanitized.set(key, value);
  });
  return sanitized;
};

export type AgentRequestRouting =
  | { mode: "webhook"; subpath?: string }
  | { mode: "subdomain" };

export default async function handleAgentRequest(
  c: Context<{ Bindings: Bindings }>,
  id: string,
  routing: AgentRequestRouting
) {
  const db = await c.env.database();
  const query = await db.selectAgentDeploymentByRequestID(id);
  if (!query) {
    // There is no agent for this request, check if it's a dev request.
    const response = await c.env.devhook?.handleRequest(id, c.req.raw);
    if (response) {
      return response;
    }
    return c.json({ message: "No agent exists for this webook" }, 404);
  }

  const incomingUrl = new URL(c.req.raw.url);

  // Handle Slack webhook requests during verification flow
  let requestBodyText: string | undefined;
  if (isSlackRequest(routing, incomingUrl.pathname) && query.agent) {
    const slackResult = await handleSlackWebhook(
      db,
      query.agent,
      c.req.raw,
      !!query.agent_deployment
    );
    if (slackResult.response) {
      return slackResult.response;
    }
    requestBodyText = slackResult.bodyText;
  }

  if (!query.agent_deployment) {
    return c.json(
      {
        message: `No deployment exists for this agent. Be sure to deploy your agent to receive webhook events`,
      },
      404
    );
  }
  const directAccessURL = query.agent_deployment.direct_access_url;
  if (!directAccessURL) {
    return c.json(
      { message: "The deployment isn't ready to receive webhook events" },
      404
    );
  }

  let url: URL;
  if (routing.mode === "webhook") {
    url = new URL(routing.subpath || "/", directAccessURL);
  } else {
    url = new URL(incomingUrl.pathname, directAccessURL);
  }
  // Ensure we preserve the search params.
  url.search = incomingUrl.search;
  // Ensure protocol is http/https for fetch.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    url.protocol = "http:";
  }

  let contentLength: number | undefined;
  const contentLengthRaw = c.req.raw.headers.get("content-length");
  if (contentLengthRaw) {
    contentLength = Number(contentLengthRaw);
    if (Number.isNaN(contentLength)) {
      contentLength = undefined;
    }
  }

  // Nobody should ever need to send more than 50MB to an agent.
  // This is even probably way too much.
  if (contentLength && contentLength > 50 * 1024 * 1024) {
    return c.json({ message: "Webhook payload is too large" }, 413);
  }

  const receivedAt = new Date();
  const startTime = performance.now();
  const signal = AbortSignal.any([
    c.req.raw.signal,
    // 10s timeout for the request.
    AbortSignal.timeout(10 * 1000),
  ]);

  // Fire-and-forget platform log for webhook request received (must not block)
  const reqId = crypto.randomUUID();
  const pathWithQuery = incomingUrl.pathname + incomingUrl.search;
  const truncatedPath =
    pathWithQuery.length > 80
      ? `${pathWithQuery.slice(0, 80)}...`
      : pathWithQuery;

  // Extract useful headers for logging (not sensitive ones)
  const interestingHeaders = [
    "origin",
    "referer",
    "user-agent",
    "content-type",
    "x-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
    "x-github-event",
    "x-github-delivery",
    "x-hub-signature",
    "x-slack-signature",
  ];
  const logHeaders: Record<string, string> = {};
  for (const header of interestingHeaders) {
    const value = c.req.raw.headers.get(header);
    if (value) {
      logHeaders[header] = value;
    }
  }

  c.executionCtx.waitUntil(
    c.env.logs.write({
      agent_id: query.agent_deployment.agent_id,
      event: {
        type: "blink.request.webhook",
        level: "info",
        ts: receivedAt.toISOString(),
        source: "platform",
        message: `↩ Webhook: ${c.req.raw.method} ${truncatedPath}`,
        agent: {
          id: query.agent_deployment.agent_id,
          deployment_id: query.agent_deployment.id,
        },
        correlation: {
          webhook_id: id,
          request_id: reqId,
        },
        request: {
          method: c.req.raw.method,
          url: c.req.raw.url,
          handler_location: detectRequestLocation(c.req.raw),
          headers: logHeaders,
        },
      },
    })
  );

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    headers.set(key, value);
  });

  // If we read the body as text (for Slack verification), we need to recalculate
  // the Content-Length header. When fetch() sends a string body, it encodes it as
  // UTF-8, which may have a different byte length than the original Content-Length.
  // Note: Some runtimes (like Bun) auto-correct this, but Node.js throws an error
  // if Content-Length doesn't match the actual body length.
  if (requestBodyText !== undefined) {
    const encoder = new TextEncoder();
    const byteLength = encoder.encode(requestBodyText).length;
    headers.set("content-length", byteLength.toString());
  }
  // Strip cookies from webhook requests to prevent session leakage
  // Subdomain requests are on a different origin, so cookies won't be sent anyway
  if (routing.mode === "webhook") {
    headers.delete("cookie");
  }
  headers.set(
    BlinkInvocationTokenHeader,
    await generateAgentInvocationToken(c.env.AUTH_SECRET, {
      agent_id: query.agent_deployment.agent_id,
      agent_deployment_id: query.agent_deployment.id,
      agent_deployment_target_id: query.agent_deployment.target_id,
    })
  );
  const sanitizedHeaders = stripHopByHopHeaders(headers);

  let response: Response | undefined;
  let error: string | undefined;
  try {
    // Use the body we already read if it's a Slack request, otherwise use the stream
    const hasBody =
      c.req.raw.method !== "GET" &&
      c.req.raw.method !== "HEAD" &&
      c.req.raw.method !== "OPTIONS";
    const bodyToSend =
      requestBodyText !== undefined ? requestBodyText : c.req.raw.body;
    const request = new Request(url.toString(), {
      method: c.req.raw.method,
      headers: sanitizedHeaders,
      body: hasBody ? bodyToSend : undefined,
      // @ts-expect-error - Required for Node.js streaming.
      duplex: hasBody ? "half" : undefined,
    });
    response = await fetch(request, { signal, redirect: "manual" });
  } catch (err) {
    error = err instanceof Error ? err.message : JSON.stringify(err);
  }

  const agentID = query.agent_deployment.agent_id;
  const deploymentID = query.agent_deployment.id;

  if (response) {
    // Strip sensitive headers from webhook responses to prevent:
    // - Session hijacking via set-cookie
    // - Permissive CORS policies that could expose user data
    // - XSS attacks via HTML responses
    // - Open redirects via Location header
    // Subdomain requests are on a different origin, so these don't apply
    if (routing.mode === "webhook") {
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("set-cookie");
      responseHeaders.delete("access-control-allow-origin");
      responseHeaders.delete("access-control-allow-credentials");
      responseHeaders.delete("access-control-allow-methods");
      responseHeaders.delete("access-control-allow-headers");

      // Prevent open redirects - strip Location header
      responseHeaders.delete("location");

      // Security headers to prevent XSS and other attacks
      // nosniff prevents browsers from MIME-sniffing responses
      responseHeaders.set("x-content-type-options", "nosniff");
      // Restrictive CSP blocks all active content (scripts, styles, etc.)
      responseHeaders.set(
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'"
      );
      // Prevent clickjacking
      responseHeaders.set("x-frame-options", "DENY");

      // Filter CORS-related values from Vary header
      const vary = responseHeaders.get("vary");
      if (vary) {
        const corsVaryValues = [
          "origin",
          "access-control-request-method",
          "access-control-request-headers",
        ];
        const filtered = vary
          .split(",")
          .map((v) => v.trim())
          .filter((v) => !corsVaryValues.includes(v.toLowerCase()));
        if (filtered.length > 0) {
          responseHeaders.set("vary", filtered.join(", "));
        } else {
          responseHeaders.delete("vary");
        }
      }

      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  if (response) {
    // Fire-and-forget platform log for successful webhook response (must not block)
    c.executionCtx.waitUntil(
      c.env.logs.write({
        agent_id: agentID,
        event: {
          type: "blink.request.webhook",
          level: "info",
          ts: new Date().toISOString(),
          source: "platform",
          message: `↩ Webhook: ${c.req.raw.method} ${truncatedPath} → ${response.status} (${durationMs}ms)`,
          agent: {
            id: agentID,
            deployment_id: deploymentID,
          },
          correlation: {
            webhook_id: id,
            request_id: reqId,
          },
          request: {
            method: c.req.raw.method,
            url: c.req.raw.url,
            handler_location: detectRequestLocation(c.req.raw),
            headers: logHeaders,
          },
          response: {
            status: response.status,
            duration_ms: durationMs,
          },
        },
      })
    );
    return response;
  } else {
    // Fire-and-forget platform log for webhook request error (must not block)
    c.executionCtx.waitUntil(
      c.env.logs.write({
        agent_id: agentID,
        event: {
          type: "blink.request.webhook",
          level: "error",
          ts: new Date().toISOString(),
          source: "platform",
          message: `↩ Webhook: ${c.req.raw.method} ${truncatedPath} → ${error || "Unknown error"} (${durationMs}ms)`,
          agent: {
            id: agentID,
            deployment_id: deploymentID,
          },
          correlation: {
            webhook_id: id,
            request_id: reqId,
          },
          request: {
            method: c.req.raw.method,
            url: c.req.raw.url,
            handler_location: detectRequestLocation(c.req.raw),
            headers: logHeaders,
          },
          error: error || "Unknown error occurred",
          response: {
            duration_ms: durationMs,
          },
        },
      })
    );
    return c.json(
      {
        message:
          "Error handling webhook. Check the Blink dashboard for more details",
      },
      500
    );
  }
}
