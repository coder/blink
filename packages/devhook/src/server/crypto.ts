/**
 * Cryptographic utilities for devhook URL generation.
 *
 * The client presents a secret, and the server signs it with HMAC-SHA256
 * using its own server secret. The resulting signature is used to generate
 * a deterministic 16-character subdomain that cannot be guessed without
 * knowing the client secret.
 */

/**
 * Generate a secure devhook ID from a client secret.
 * Uses HMAC-SHA256 with the server secret, then base64url encodes
 * and truncates to 16 characters.
 *
 * @param clientSecret - The secret provided by the client
 * @param serverSecret - The server's secret key for signing
 * @returns A 16-character URL-safe devhook ID
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

  // Convert to hex and take first 16 characters
  const bytes = new Uint8Array(signature);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hex.substring(0, 16).toLowerCase();
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
