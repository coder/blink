const KEY_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const API_KEY_PREFIX = "bk";

async function randomFromAlphabet(
  alphabet: string,
  len: number
): Promise<string> {
  const { randomInt } = await import("node:crypto");
  if (alphabet.length < 2) {
    throw new Error("Alphabet too small");
  }
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const j = randomInt(0, alphabet.length); // [0, n)
    out.push(alphabet[j] as string);
  }
  return out.join("");
}

async function hmacHexSHA256(
  keySecret: string,
  pepper: string
): Promise<string> {
  const { webcrypto } = await import("node:crypto");
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keySecret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signature = await webcrypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(pepper)
  );
  return Buffer.from(signature).toString("hex");
}

const PEPPER_CACHE = new Map<string, string>();

async function derivePepper(rootSecret: string): Promise<string> {
  // in API key authentication, the root secret is usually the AUTH_SECRET environment variable,
  // so it stays constant for the lifetime of the application. we cache the pepper
  // to avoid re-deriving it for each API key.
  const cached = PEPPER_CACHE.get(rootSecret);
  if (cached) {
    return cached;
  }
  if (PEPPER_CACHE.size >= 128) {
    const aKey = PEPPER_CACHE.keys().next().value!;
    if (!aKey) {
      throw new Error("No key to delete");
    }
    PEPPER_CACHE.delete(aKey);
  }
  const { webcrypto } = await import("node:crypto");
  const rootKey = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rootSecret),
    { name: "HKDF" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const params = {
    name: "HKDF",
    hash: "SHA-256",
    salt: new TextEncoder().encode("pepper"),
    info: new TextEncoder().encode("pepper"),
  };
  // derive 256 bits (32 bytes)
  const bits = await webcrypto.subtle.deriveBits(params, rootKey, 256);
  return Buffer.from(bits).toString("hex");
}

export function parseApiKey(
  key: string
):
  | { prefix: string; lookup: string; secret: string; error?: undefined }
  | { error: string } {
  const [prefix, lookup, secret] = key.split("_");
  if (!prefix || !lookup || !secret) {
    return { error: "Invalid API key" };
  }
  if (prefix !== API_KEY_PREFIX) {
    return { error: "Invalid API key prefix" };
  }
  return { prefix, lookup, secret };
}

function constructApiKeyString(args: {
  prefix: string;
  lookup: string;
  secret: string;
}): string {
  return `${args.prefix}_${args.lookup}_${args.secret}`;
}

/**
 * Generates a new API key in format: `bk_<lookup>_<secret>`
 *
 * Returns the full key to show the user once, plus a hash to store in the database.
 * The hash is derived via HMAC-SHA256(keySecret, pepper) where pepper is derived from rootSecret.
 *
 * - lookup: 12-char identifier for fast DB retrieval
 * - secret: 32-char secret the user keeps (never store this)
 * - hash: what you store in DB for verification
 *
 * The pepper system means an attacker needs both the database AND the rootSecret to verify keys,
 * making it more secure than a simple hash.
 */
export async function newApiKeyString(rootSecret: string): Promise<{
  lookup: string;
  secret: string;
  prefix: string;
  hash: string;
  fullKey: string;
}> {
  // a pepper is a random string deterministically derived from the root secret
  const pepper = await derivePepper(rootSecret);
  const lookup = await randomFromAlphabet(KEY_CHARS, 12);
  const keySecret = await randomFromAlphabet(KEY_CHARS, 32);
  // a key hash is the signature obtained by signing the pepper with the key secret using HMAC-SHA256
  const keyHash = await hmacHexSHA256(keySecret, pepper);
  return {
    lookup,
    secret: keySecret,
    prefix: API_KEY_PREFIX,
    hash: keyHash,
    fullKey: constructApiKeyString({
      prefix: API_KEY_PREFIX,
      lookup,
      secret: keySecret,
    }),
  };
}

/**
 * Verifies an API key by comparing the stored hash against a freshly computed one.
 *
 * Re-derives the pepper from rootSecret, computes HMAC-SHA256(keySecret, pepper),
 * and performs a timing-safe comparison to prevent side-channel attacks.
 */
export async function verifyApiKeyString(args: {
  rootSecret: string;
  keySecret: string;
  hash: string;
}): Promise<boolean> {
  const { rootSecret, keySecret, hash } = args;
  const pepper = await derivePepper(rootSecret);
  const keyHash = await hmacHexSHA256(keySecret, pepper);

  const { timingSafeEqual } = await import("node:crypto");
  const isValid =
    keyHash.length === hash.length &&
    timingSafeEqual(Buffer.from(keyHash), Buffer.from(hash));
  return isValid;
}
