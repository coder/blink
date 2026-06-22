import { expect, test } from "bun:test";
import { serve } from "../test";

test("POST+GET /api/files", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();
  const file = new File(["Hello, world!"], "test.txt");
  const resp = await client.files.upload(file);
  expect(resp.id).toBeString();
  expect(resp.url).toBeString();

  const fileResp = await client.files.get(resp.id);
  expect(await fileResp.text()).toBe("Hello, world!");
});

test("GET /api/files serves uploaded files inline with restrictive headers", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();
  const file = new File(["<h1>content</h1>"], "content.html", {
    type: "text/html",
  });

  const uploaded = await client.files.upload(file);
  const response = await fetch(uploaded.url);

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<h1>content</h1>");
  expect(response.headers.get("content-type")).toStartWith("text/html");
  expect(response.headers.get("content-disposition")).toBe(
    'inline; filename="content.html"'
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const csp = response.headers.get("content-security-policy");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("sandbox");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response.headers.get("x-frame-options")).toBeNull();
});
