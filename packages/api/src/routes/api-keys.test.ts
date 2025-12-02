import { expect, test } from "bun:test";
import {
  newApiKeyString,
  parseApiKey,
  verifyApiKeyString,
} from "./api-keys.server";

test("newApiKeyString", async () => {
  const rootSecret = "test-root-secret";
  const { lookup, secret, prefix, hash, fullKey } =
    await newApiKeyString(rootSecret);
  expect(lookup).toBeDefined();
  expect(secret).toBeDefined();
  expect(prefix).toBe("bk");
  expect(hash).toBeDefined();
  expect(fullKey).toBeDefined();
  // bk_<lookup>_<secret>
  expect(fullKey.length).toBe(2 + 1 + 12 + 1 + 32);
});

test("verifyApiKeyString", async () => {
  const rootSecret = "test-root-secret";
  const key = "bk_6ZdOMx6Z7W2n_0KICJOuLfiq4ftiYmOg9bl3BxSpnpX2Z";
  const hash =
    "1710fb0c40fa96d679db8ba59851b9451d5a075af0a275735b2043ab177fd9ae";
  const parsed = parseApiKey(key);
  if (parsed.error !== undefined) {
    throw new Error("this should never happen");
  }
  const verified = await verifyApiKeyString({
    rootSecret,
    keySecret: parsed.secret,
    hash,
  });
  expect(verified).toBe(true);

  expect(
    await verifyApiKeyString({
      rootSecret,
      keySecret: parsed.secret + "x",
      hash,
    })
  ).toBe(false);

  expect(
    await verifyApiKeyString({
      rootSecret,
      keySecret: parsed.secret,
      hash: hash + "x",
    })
  ).toBe(false);
});
