import { expect, test } from "bun:test";
import { serve } from "../../test";

test("GET+POST /api/auth/token", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  let url: string;
  let resolve!: Promise<Response>;
  const res = await client.auth.token((u, id) => {
    url = u;
    // When the callback happens, it's listening.
    resolve = client.request(
      "POST",
      "/api/auth/token",
      JSON.stringify({
        id,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  });
  expect(res).toBeString();

  const resolveResp = await resolve;
  expect(resolveResp.status).toBe(204);
});
