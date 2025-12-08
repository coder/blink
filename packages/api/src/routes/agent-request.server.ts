import { BlinkInvocationTokenHeader } from "@blink.so/runtime/types";
import type { Context } from "hono";
import type { Bindings } from "../server";
import { detectRequestLocation } from "../server-helper";
import { generateAgentInvocationToken } from "./agents/me/me.server";

export default async function handleAgentRequest(
  c: Context<{ Bindings: Bindings }>,
  id: string,
  legacy?: boolean
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
  const incomingUrl = new URL(c.req.raw.url);

  let url: URL;
  if (legacy) {
    url = new URL("/webhook" + incomingUrl.search, directAccessURL);
  } else {
    url = new URL(incomingUrl.pathname, directAccessURL);
  }
  // Ensure we preserve the search params.
  url.search = incomingUrl.search;

  let contentLength: number | undefined;
  const contentLengthRaw = c.req.raw.headers.get("content-length");
  if (contentLengthRaw) {
    contentLength = Number(contentLengthRaw);
    if (isNaN(contentLength)) {
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
      ? pathWithQuery.slice(0, 80) + "..."
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

  let requestBodyPromise: Promise<ReadBodyResult | undefined> | undefined;
  let upstreamBody: ReadableStream | undefined;
  if (c.req.raw.body) {
    let downstreamBody: ReadableStream;
    [upstreamBody, downstreamBody] = c.req.raw.body.tee();
    requestBodyPromise = readBody(c.req.raw.headers, downstreamBody, 64 * 1024);
  }

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    headers.set(key, value);
  });
  headers.set(
    BlinkInvocationTokenHeader,
    await generateAgentInvocationToken(c.env.AUTH_SECRET, {
      agent_id: query.agent_deployment.agent_id,
      agent_deployment_id: query.agent_deployment.id,
      agent_deployment_target_id: query.agent_deployment.target_id,
    })
  );

  let response: Response | undefined;
  let error: string | undefined;
  try {
    response = await fetch(url, {
      body: upstreamBody,
      method: c.req.raw.method,
      signal,
      headers,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : JSON.stringify(err);
  }

  const agentID = query.agent_deployment.agent_id;
  const deploymentID = query.agent_deployment.id;

  let responseBodyPromise: Promise<ReadBodyResult | undefined> | undefined;
  if (response && response.body) {
    const [toClient, toLog] = response.body.tee();
    responseBodyPromise = readBody(response.headers, toLog, 64 * 1024);
    response = new Response(toClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
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

interface RedactHeadersResult {
  headers: Record<string, string>;
  redacted: boolean;
}

// redactHeaders replaces sensitive headers with "REDACTED" and
// limits the number of headers to 100.
function redactHeaders(incoming: Headers): RedactHeadersResult {
  const headers: Record<string, string> = {};
  let headerCount = 0;
  let redacted = false;
  const sensitiveHeaders = ["authorization", "cookie", "set-cookie"];
  incoming.forEach((value, key) => {
    if (headerCount >= 60) {
      redacted = true;
      return;
    }
    if (key.length > 128) {
      redacted = true;
      key = key.slice(0, 128);
    }
    if (value.length > 2048) {
      redacted = true;
      value = value.slice(0, 2048) + " ... [truncated]";
    }
    headerCount++;
    if (sensitiveHeaders.includes(key.toLowerCase())) {
      headers[key] = "REDACTED";
    } else {
      headers[key] = value;
    }
  });
  return {
    headers: headers,
    redacted,
  };
}

interface ReadBodyResult {
  body: string;
  truncated: boolean;
}

async function readBody(
  headers: Headers,
  body: ReadableStream,
  maxLength: number
): Promise<ReadBodyResult | undefined> {
  if (!isTextual(headers.get("content-type"))) {
    // For non-textual content, cancel the stream immediately.
    // We don't need to read it, just ensure it's canceled to signal
    // to Cloudflare that we're not using this teed stream.
    await body.cancel();
    return undefined;
  }
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    let result = "";
    let totalRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      result += chunk;
      totalRead += chunk.length;
      if (totalRead > maxLength) {
        // Cancel the reader - we've read enough
        await reader.cancel();
        return {
          body: result,
          truncated: true,
        };
      }
    }
    return {
      body: result,
      truncated: false,
    };
  } finally {
    reader.releaseLock();
  }
}

const isTextual = (contentType: string | null) => {
  if (!contentType) {
    return false;
  }
  const v = contentType.toLowerCase();
  return (
    v.startsWith("text/") ||
    v.includes("json") ||
    v.includes("xml") ||
    v.includes("x-www-form-urlencoded") ||
    v.includes("graphql") ||
    v.includes("cloudevents+json")
  );
};
