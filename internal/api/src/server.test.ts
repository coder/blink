import { expect, test } from "bun:test";
import Client from "./client.node";
import { serve } from "./test";

test("GET /api", async () => {
  const { url } = await serve();
  const client = new Client({ baseURL: url.toString() });

  const response = await client.request("GET", "/api");
  const body = await response.json();
  expect(body).toEqual({
    message: "Hello, world!",
  });
});
