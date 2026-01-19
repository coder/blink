import { expect, test } from "bun:test";
import { serve } from "../test";

test("devhook url with createRequestURL", async () => {
  const { helpers, bindings } = await serve();
  const { client } = await helpers.createUser();

  const id = crypto.randomUUID();

  const url = await client.devhook.getUrl(id);
  expect(url).toBe(bindings.createRequestURL!(id).toString().replace(/\/$/, ""));
});

test("devhook url with path-based routing", async () => {
  const { helpers, bindings } = await serve({
    bindings: {
      createRequestURL: undefined,
    },
  });
  const { client } = await helpers.createUser();

  const id = crypto.randomUUID();

  const url = await client.devhook.getUrl(id);
  const expectedUrl = new URL(`api/webhook/${id}`, bindings.accessUrl);
  expect(url).toBe(expectedUrl.toString());
});

test("devhook", async () => {
  const { helpers, bindings, url } = await serve();
  // This endpoint doesn't actually need auth, we just
  // create a user to easily get a client.
  const { client } = await helpers.createUser();

  const id = crypto.randomUUID();

  let resolveConnect: () => void;
  const connectPromise = new Promise<void>((resolve) => {
    resolveConnect = resolve;
  });

  let requestReceived = false;
  client.devhook.listen({
    id,
    onError: (err) => {
      console.error("Error", err);
    },
    onRequest: async (req) => {
      requestReceived = true;
      // Verify the request URL is correct.
      return new Response("Hello from devhook!");
    },
    onConnect: () => {
      resolveConnect?.();
    },
  });

  // Ensure connection works.
  await connectPromise;

  // Test wildcard hostname routing.
  // We need to make the request go through the test server with the correct Host header.
  const devhookURL = bindings.createRequestURL!(id);
  const response = await fetch(url, { headers: { Host: devhookURL.host } });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello from devhook!");
  expect(requestReceived).toBe(true);
});
