/**
 * Cryptographic utilities for devhook URL generation.
 *
 * The client presents a secret, and the server signs it with HMAC-SHA256
 * using its own server secret. The resulting signature is used to generate
 * a deterministic 16-character subdomain that cannot be guessed without
 * knowing the client secret.
 *
 * We use base36 encoding (a-z, 0-9) to maximize entropy per character.
 * With 16 characters and 36 possible values each, we get:
 * 36^16 ≈ 7.96 × 10^24 ≈ 2^82.7 possible IDs
 *
 * This is significantly better than hex encoding which only provides:
 * 16^16 = 2^64 possible IDs
 */

/** Base36 alphabet: 0-9, a-z */
const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Convert a Uint8Array to a base36 string.
 * Uses the full entropy of the input bytes.
 *
 * @param bytes - The bytes to convert
 * @param length - The desired output length
 * @returns A base36 string of the specified length
 */
function bytesToBase36(bytes: Uint8Array, length: number): string {
  // We need to convert arbitrary bytes to base36.
  // To do this properly and use all entropy, we treat the bytes as a big integer
  // and repeatedly divide by 36, taking the remainder as each character.
  //
  // For 16 base36 characters, we need at least ceil(16 * log2(36) / 8) = ceil(82.7 / 8) = 11 bytes
  // SHA-256 gives us 32 bytes, so we have plenty of entropy.

  // Convert bytes to a BigInt (big-endian)
  let num = BigInt(0);
  for (const byte of bytes) {
    num = (num << BigInt(8)) | BigInt(byte);
  }

  // Convert to base36
  const result: string[] = [];
  const base = BigInt(36);

  for (let i = 0; i < length; i++) {
    const remainder = num % base;
    result.unshift(BASE36_ALPHABET[Number(remainder)]!);
    num = num / base;
  }

  return result.join("");
}

/**
 * Generate a secure devhook ID from a client secret.
 * Uses HMAC-SHA256 with the server secret, then converts to base36.
 *
 * @param clientSecret - The secret provided by the client
 * @param serverSecret - The server's secret key for signing
 * @returns A 16-character base36 devhook ID (a-z, 0-9)
 */
export async function generateDevhookId(
  clientSecret: string,
  serverSecret: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Import the server secret as an HMAC key
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(serverSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign the client secret
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(clientSecret)
  );

  // Convert to base36 (using all 32 bytes of SHA-256 output)
  return bytesToBase36(new Uint8Array(signature), 16);
}

/**
 * Verify that a devhook ID matches the expected value for a client secret.
 *
 * @param devhookId - The devhook ID to verify
 * @param clientSecret - The client secret that should produce this ID
 * @param serverSecret - The server's secret key
 * @returns True if the ID is valid for this client secret
 */
export async function verifyDevhookId(
  devhookId: string,
  clientSecret: string,
  serverSecret: string
): Promise<boolean> {
  const expected = await generateDevhookId(clientSecret, serverSecret);
  return devhookId === expected;
}
