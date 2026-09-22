import { describe, expect, test } from "bun:test";
import BrowserClient from "./client.browser";

describe("client default headers", () => {
  test("merges defaults, generated headers, and request overrides without leaking overrides", async () => {
    const requests: Headers[] = [];
    const defaults = {
      "X-Gateway": "secret",
      authorization: "default",
      "content-type": "text/plain",
    };
    const client = new BrowserClient({
      headers: defaults,
      authToken: "session",
      fetch: (async (_url, init) => {
        requests.push(new Headers(init?.headers));
        return new Response();
      }) as typeof fetch,
    });
    defaults["X-Gateway"] = "changed";
    await client.request("POST", "/api/test", "{}", {
      headers: {
        "x-gateway": "override",
        AUTHORIZATION: "request",
        "CONTENT-TYPE": "custom/type",
      },
    });
    await client.request("POST", "/api/test", "{}");
    expect(Object.fromEntries(requests[0]!)).toEqual({
      "x-gateway": "override",
      authorization: "request",
      "content-type": "custom/type",
    });
    expect(Object.fromEntries(requests[1]!)).toEqual({
      "x-gateway": "secret",
      authorization: "Bearer session",
      "content-type": "application/json",
    });
  });
});
