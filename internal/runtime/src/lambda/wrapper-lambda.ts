// The purpose of this file is to wrap the Lambda runtime
// request/response handling in a way that is compatible with
// the Blink Agent exports.
//
// After any edits are made, run `./scripts/generate.ts` to
// regenerate this file. The generated file is source-controlled.

import {
  BlinkInvocationAuthTokenEnvironmentVariable,
  BlinkInvocationTokenHeader,
} from "@blink.so/runtime/types";
import { runWithAuth } from "blink/internal";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import {
  patchFetchWithAuth,
  startAgentServer,
  startInternalAPIServer,
} from "../server";

const { server, port } = startInternalAPIServer();
// It is *extremely* important for Lambda's that we unref the server.
// Otherwise, the Lambda will not exit when requests are made.
// It will hang until the timeout.
server.unref();
patchFetchWithAuth(`http://127.0.0.1:${port}`);

if (!process.env.ENTRYPOINT) {
  throw new Error("developer error: ENTRYPOINT is not set");
}

// We must unref here, otherwise the Lambda will stay running.
const agent = await startAgentServer(
  resolve(process.env.ENTRYPOINT),
  port + 1,
  true
);

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    // Build canonical Headers first to extract auth token
    const headers = buildHeaders(event);

    // Extract and strip Blink auth token (case-insensitive)
    let authToken: string | undefined;
    for (const [k, v] of headers.entries()) {
      if (k.toLowerCase() === BlinkInvocationTokenHeader.toLowerCase()) {
        authToken = v;
        headers.delete(k);
        break;
      }
    }

    // Legacy: Set env var for older blink package versions that don't use ALS.
    // This is safe for Lambda since it handles one request at a time.
    process.env[BlinkInvocationAuthTokenEnvironmentVariable] = authToken ?? "";

    // Use AsyncLocalStorage to ensure each request has its own auth context.
    // The patched fetch will read from this context when making internal API requests.
    return runWithAuth(authToken ?? "", async () => {
      // This prevents Lambda's from staying alive after we respond to a request.
      // context.callbackWaitsForEmptyEventLoop = false;

      // Lambda's never handle requests concurrently, but they do sequentially.
      //
      // We can just reset the waitUntil func at the beginning of requests
      // to ensure they get a clean context.
      //
      // This is an internal symbol we use to expose waitUntil to agent code.
      // It's not exported from the runtime package, so it's safe to use.
      // We use a Symbol to avoid collisions with other libraries.
      const waitUntilSymbol = Symbol.for("@blink/waitUntil");
      // Storage for promises registered via waitUntil
      const waitUntilPromises: Promise<any>[] = [];
      // Expose waitUntil on globalThis
      (globalThis as any)[waitUntilSymbol] = (promise: Promise<any>) => {
        waitUntilPromises.push(promise);
      };

      const isV2 = "rawPath" in event;
      const path = isV2 ? event.rawPath : event.path;
      const query = isV2
        ? event.rawQueryString
        : new URLSearchParams(event.queryStringParameters || {}).toString();
      const method = isV2
        ? event.requestContext?.http?.method
        : event.httpMethod;

      const url = new URL(
        path + (query ? `?${query}` : ""),
        "https://lambda.internal"
      );

      let body: string | Buffer | undefined;
      if (event.body != null && method !== "GET" && method !== "HEAD") {
        body = event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body;
      }

      // It is *extremely* important that we have a controller here.
      // If we do not, it's possible upstream that the request closes,
      // and we don't notice - then the Lambda's run until timeout.
      const controller = new AbortController();
      const onCloseOrError = () => {
        controller.abort();
      };
      responseStream.on("close", onCloseOrError);
      responseStream.on("error", onCloseOrError);

      // abort a bit before Lambda hard timeout
      // we need a bit of extra time to call `/_agent/flush-otel` after the main request is finished
      const msLeft = Math.max(0, context.getRemainingTimeInMillis() - 5000);
      const timeout = setTimeout(() => controller.abort(), msLeft);

      try {
        const res: Response = await agent.fetch(
          url,
          { method, body, headers, signal: controller.signal },
          { event, lambdaContext: context }
        );

        const resHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          resHeaders[key] = value;
        });

        const cookies =
          res.headers.getSetCookie?.() ??
          (res.headers.get("set-cookie")
            ? [res.headers.get("set-cookie") as string]
            : []);

        const http = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: res.status,
          headers: resHeaders,
          cookies,
        });

        if (res.body) {
          await res.body.pipeTo(
            Writable.toWeb(http) as WritableStream<Uint8Array<ArrayBufferLike>>,
            { signal: controller.signal }
          );
        } else {
          http.end();
        }
      } catch (err) {
        try {
          const http = awslambda.HttpResponseStream.from(responseStream, {
            statusCode: controller.signal.aborted ? 499 : 502,
            headers: { "content-type": "application/json" },
          });
          http.write(
            JSON.stringify({
              message: controller.signal.aborted
                ? "client closed"
                : "upstream error",
            })
          );
          http.end();
        } catch {}
      } finally {
        clearTimeout(timeout);
        responseStream.off("close", onCloseOrError);
        responseStream.off("error", onCloseOrError);

        const flushController = new AbortController();
        const flushTimeout = setTimeout(
          () => flushController.abort("timeout"),
          5000
        );
        try {
          // Wait for all waitUntil promises to settle before flushing
          await Promise.allSettled(waitUntilPromises);

          // Ensure all OpenTelemetry spans are flushed before the Lambda exits.
          await agent.fetch(
            new URL("/_agent/flush-otel", "http://lambda.internal"),
            {
              method: "POST",
              signal: flushController.signal,
            }
          );
        } catch {
          // Ignore errors. Older agents may not have the flush endpoint.
        } finally {
          clearTimeout(flushTimeout);
        }
      }
    }); // end runWithAuth
  }
);

function buildHeaders(event: any): Headers {
  const out = new Headers();

  // 1) Start with single-value headers
  const hv1 = event?.headers ?? {};
  for (const [k, v] of Object.entries(hv1)) {
    if (v == null) continue;
    out.set(k, String(v));
  }

  // 2) Merge multiValueHeaders (v1)
  const mv = event?.multiValueHeaders ?? {};
  for (const [k, arr] of Object.entries(mv)) {
    if (!Array.isArray(arr)) continue;
    // Remove any single value we might have set, then append all
    out.delete(k);
    for (const v of arr) out.append(k, String(v));
  }

  // 3) Merge cookies (v2 puts them outside headers)
  if (Array.isArray(event?.cookies) && event.cookies.length) {
    // If caller already sent Cookie header(s), append
    const existing = out.get("cookie");
    const merged = [existing, event.cookies.join("; ")]
      .filter(Boolean)
      .join("; ");
    out.set("cookie", merged);
  }

  // 4) Forwarding hints useful to Hono/URL building
  // (only set if not already present)
  if (!out.has("x-forwarded-proto")) out.set("x-forwarded-proto", "https");
  if (!out.has("x-forwarded-host") && out.has("host")) {
    out.set("x-forwarded-host", out.get("host")!);
  }

  // 5) Optional: source IP → X-Forwarded-For
  const sourceIp =
    event?.requestContext?.http?.sourceIp ??
    event?.requestContext?.identity?.sourceIp;
  if (sourceIp) {
    const xff = out.get("x-forwarded-for");
    out.set("x-forwarded-for", xff ? `${xff}, ${sourceIp}` : sourceIp);
  }

  return out;
}
