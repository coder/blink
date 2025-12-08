import { expect, test } from "bun:test";
import connectToPostgres from "./postgres";
import Querier from "./querier";
import { createPostgresURL } from "./test";

test("createPostgres", async () => {
  const start = Date.now();
  const url = await createPostgresURL();
  const end = Date.now();
  const querier = new Querier(await connectToPostgres(url));
  const user = await querier.selectUserByID(crypto.randomUUID());
  expect(user).toBeUndefined();

  const start2 = Date.now();
  await createPostgresURL();
  const end2 = Date.now();

  // Subsequent creation should be faster or at least not significantly slower,
  // because it's using the template. Allow for some variance in CI environments.
  expect(end2 - start2).toBeLessThan((end - start) * 1.5);
});

// This tests if our postgres worker is actually functioning properly.
// We do a *LOT* of jank to make it so we can have concurrent clients.
test("createPostgres concurrent clients", async () => {
  const url = await createPostgresURL();

  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      new Querier(await connectToPostgres(url)).selectUserByID(
        crypto.randomUUID()
      )
    );
  }

  await Promise.all(promises);
});
