/**
 * Cryptographic utilities for tunnel URL generation.
 *
 * Deterministically derives a uniform 16-character base36 string from:
 *   - a client secret (password), and
 *   - a server secret key for HMAC.
 *
 * Core idea:
 *   - HMAC-SHA-256 is used as a deterministic pseudorandom function (PRF).
 *   - We map the PRF output into [0, 36^16) using rejection sampling to avoid modulo bias.
 *
 * We use base36 encoding (a-z, 0-9) to maximize entropy per character.
 * With 16 characters and 36 possible values each, we get:
 * 36^16 ≈ 7.96 × 10^24 ≈ 2^82.7 possible IDs
 */

/** Domain separation constant for tunnel ID generation */
const DOMAIN = "blink-tunnel";

/**
 * Convert 16 bytes to an unsigned 128-bit BigInt (big-endian).
 */
function bytesToBigInt128(bytes: Uint8Array, off: number): bigint {
  let x = 0n;
  for (let i = 0; i < 16; i++) {
    const b = bytes[off + i];
    if (b === undefined) {
      throw new Error("Unexpected: bytes is too short");
    }
    x = (x << 8n) + BigInt(b);
  }
  return x;
}

/**
 * Generate a secure tunnel ID from a client secret.
 * Uses HMAC-SHA256 with the server secret, then converts to base36 using
 * rejection sampling to ensure uniform distribution.
 *
 * @param clientSecret - The secret provided by the client (password)
 * @param serverSecret - The server's secret key for signing
 * @returns A 16-character base36 tunnel ID (a-z, 0-9)
 */
export async function generateTunnelId(
  clientSecret: string,
  serverSecret: string
): Promise<string> {
  const enc = new TextEncoder();

  // WebCrypto works with bytes; TextEncoder gives deterministic UTF-8 bytes.
  const keyBytes = enc.encode(serverSecret);

  // Import the HMAC key into WebCrypto.
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // We want a 16-character base36 string. That's exactly the integers in [0, 36^16).
  const N = 36n ** 16n; // size of the output space

  // We'll draw 128-bit candidates from the PRF output and "reject" ones that would bias the mapping.
  const TWO128 = 1n << 128n;

  // Rejection sampling threshold:
  // limit is the largest multiple of N that is < 2^128.
  // If we only accept x < limit, then x % N is perfectly uniform in [0, N).
  const limit = (TWO128 / N) * N;

  // One HMAC-SHA-256 output is 32 bytes, which conveniently contains two independent
  // 128-bit candidates (first 16 bytes and last 16 bytes).
  //
  // Rejection sampling very rarely rejects when N is close to 2^k, but we still implement
  // the correct rejection loop to guarantee uniformity.
  for (let ctr = 0; ctr < 1000; ctr++) {
    // Build the message to MAC:
    // - DOMAIN: separates different uses / versions
    // - clientSecret: user input
    // - ctr: deterministic retry stream
    //
    // The \0 separators avoid ambiguous concatenations like ("ab", "c") vs ("a", "bc").
    const msg = enc.encode(`${DOMAIN}\0${clientSecret}\0${ctr}`);

    // HMAC the message. WebCrypto returns an ArrayBuffer; wrap in Uint8Array for byte access.
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", cryptoKey, msg)
    );

    // Try two 128-bit candidates per MAC output.
    for (const off of [0, 16]) {
      const x = bytesToBigInt128(mac, off);

      // Reject values in the "tail" [limit, 2^128) because modulo would make some outputs
      // slightly more likely than others (modulo bias).
      if (x < limit) {
        const y = x % N; // now y is uniform in [0, 36^16)

        // Convert to base36 and left-pad with '0' to ensure fixed length of 16 chars.
        return y.toString(36).padStart(16, "0");
      }
    }
  }

  // If you ever hit this (extremely unlikely), increase the loop bound.
  throw new Error("Unexpected: too many rejections; increase loop bound.");
}

/**
 * Verify that a tunnel ID matches the expected value for a client secret.
 *
 * @param tunnelId - The tunnel ID to verify
 * @param clientSecret - The client secret that should produce this ID
 * @param serverSecret - The server's secret key
 * @returns True if the ID is valid for this client secret
 */
export async function verifyTunnelId(
  tunnelId: string,
  clientSecret: string,
  serverSecret: string
): Promise<boolean> {
  const expected = await generateTunnelId(clientSecret, serverSecret);
  return tunnelId === expected;
}
