import { expect, test } from "bun:test";
import { serve } from "../test";

test("POST+GET /api/files", async () => {
  const { helpers } = await serve();
  const { client, user } = await helpers.createUser();
  const file = new File(["Hello, world!"], "test.txt");
  const resp = await client.files.upload(file);
  expect(resp.id).toBeString();
  expect(resp.url).toBeString();

  const fileResp = await client.files.get(resp.id);
  expect(await fileResp.text()).toBe("Hello, world!");
});
