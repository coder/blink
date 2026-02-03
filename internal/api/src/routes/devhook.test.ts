import { expect, test } from "bun:test";
import { serve } from "../test";

test("devhook url with createRequestURL", async () => {
  const { helpers, bindings } = await serve();
  const { client } = await helpers.createUser();

  const id = crypto.randomUUID();

  const url = await client.devhook.getUrl(id);
  expect(url).toBe(
    bindings.createRequestURL!(id).toString().replace(/\/$/, "")
  );
});

test("devhook routes require auth by default", async () => {
  const { url } = await serve();
  const id = crypto.randomUUID();

  const urlResponse = await fetch(new URL(`/api/devhook/${id}/url`, url));
  expect(urlResponse.status).toBe(401);

  const listenResponse = await fetch(new URL(`/api/devhook/${id}`, url));
  expect(listenResponse.status).toBe(401);
});

test("devhook routes allow unauthenticated access when disableAuth is true", async () => {
  const { url, bindings } = await serve({
    bindings: { devhook: { disableAuth: true } },
  });
  const id = crypto.randomUUID();

  const urlResponse = await fetch(new URL(`/api/devhook/${id}/url`, url));
  expect(urlResponse.status).toBe(200);
  const data = await urlResponse.json();
  expect(data.url).toBe(
    bindings.createRequestURL!(id).toString().replace(/\/$/, "")
  );

  // Listen endpoint tries to upgrade to WebSocket, so without proper headers
  // it won't succeed, but it should not return 401
  const listenResponse = await fetch(new URL(`/api/devhook/${id}`, url));
  expect(listenResponse.status).not.toBe(401);
});

test.each([
  { disableAuth: true, name: "without auth" },
  { disableAuth: false, name: "with auth" },
])("devhook listen $name", async ({ disableAuth }) => {
  const { helpers, bindings, url } = await serve({
    bindings: { devhook: { disableAuth } },
  });
  const { client } = await helpers.createUser();

  const id = crypto.randomUUID();

  let resolveConnect: () => void;
  const connectPromise = new Promise<void>((resolve) => {
    resolveConnect = resolve;
  });

  let requestReceived = false;
  client.devhook.listen({
    id,
    onError: () => {},
    onRequest: async () => {
      requestReceived = true;
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
