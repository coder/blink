import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

// Constants for AES-256-GCM
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16; // 128 bits

export interface EncryptedData {
  encryptedValue: Buffer;
  encryptedDEK: Buffer;
  encryption_iv: Buffer;
  encryption_auth_tag: Buffer;
}

/**
 * Derives a Key Encryption Key (KEK) from the master key using scrypt.
 */
async function deriveKEK(masterKey: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(masterKey, salt, KEY_LENGTH)) as Buffer;
}

/**
 * Encrypts a plaintext value using envelope encryption.
 *
 * Process:
 * 1. Generate a random Data Encryption Key (DEK)
 * 2. Use DEK to encrypt the plaintext value with AES-256-GCM
 * 3. Derive KEK from master key using scrypt with a random salt
 * 4. Encrypt the DEK with the KEK
 * 5. Return encrypted value, encrypted DEK, IV, and auth tag
 *
 * @param plaintext - The value to encrypt
 * @param masterKey - The master key from environment
 * @returns Encrypted data components
 */
export async function encryptValue(
  plaintext: string,
  masterKey: string
): Promise<EncryptedData> {
  // Generate random DEK
  const dek = randomBytes(KEY_LENGTH);

  // Generate random IV for value encryption
  const encryption_iv = randomBytes(IV_LENGTH);

  // Encrypt the plaintext value with DEK
  const cipher = createCipheriv(ALGORITHM, dek, encryption_iv);
  const encryptedValue = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const encryption_auth_tag = cipher.getAuthTag();

  // Generate salt for KEK derivation
  const salt = randomBytes(SALT_LENGTH);

  // Derive KEK from master key
  const kek = await deriveKEK(masterKey, salt);

  // Encrypt the DEK with KEK
  const dekIV = randomBytes(IV_LENGTH);
  const dekCipher = createCipheriv(ALGORITHM, kek, dekIV);
  const encryptedDEKData = Buffer.concat([
    dekCipher.update(dek),
    dekCipher.final(),
  ]);
  const dekAuthTag = dekCipher.getAuthTag();

  // Combine salt, IV, auth tag, and encrypted DEK into one buffer
  // Format: [salt(16)][iv(12)][authTag(16)][encryptedDEK(32)]
  const encryptedDEK = Buffer.concat([
    salt,
    dekIV,
    dekAuthTag,
    encryptedDEKData,
  ]);

  return {
    encryptedValue,
    encryptedDEK,
    encryption_iv,
    encryption_auth_tag,
  };
}

/**
 * Decrypts an encrypted value using envelope encryption.
 *
 * Process:
 * 1. Extract salt, IV, auth tag, and encrypted DEK from the encryptedDEK buffer
 * 2. Derive KEK from master key using the extracted salt
 * 3. Decrypt the DEK using the KEK
 * 4. Use the DEK to decrypt the value
 *
 * @param encrypted - The encrypted data components
 * @param masterKey - The master key from environment
 * @returns The decrypted plaintext value
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decryptValue(
  encrypted: EncryptedData,
  masterKey: string
): Promise<string> {
  // Extract components from encryptedDEK buffer
  // Format: [salt(16)][iv(12)][authTag(16)][encryptedDEK(32)]
  const salt = encrypted.encryptedDEK.subarray(0, SALT_LENGTH);
  const dekIV = encrypted.encryptedDEK.subarray(
    SALT_LENGTH,
    SALT_LENGTH + IV_LENGTH
  );
  const dekAuthTag = encrypted.encryptedDEK.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const encryptedDEKData = encrypted.encryptedDEK.subarray(
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );

  // Derive KEK from master key
  const kek = await deriveKEK(masterKey, salt);

  // Decrypt the DEK
  const dekDecipher = createDecipheriv(ALGORITHM, kek, dekIV);
  dekDecipher.setAuthTag(dekAuthTag);
  const dek = Buffer.concat([
    dekDecipher.update(encryptedDEKData),
    dekDecipher.final(),
  ]);

  // Decrypt the value with the DEK
  const decipher = createDecipheriv(ALGORITHM, dek, encrypted.encryption_iv);
  decipher.setAuthTag(encrypted.encryption_auth_tag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted.encryptedValue),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

/**
 * Gets the master encryption key from the environment.
 * In production, this should be stored in Cloudflare Worker secrets.
 *
 * @returns The master key, or null if not configured (allowing graceful degradation)
 */
export function getMasterKey(): string | null {
  return process.env.ENCRYPTION_MASTER_KEY ?? null;
}

/**
 * Checks if encryption is enabled (master key is configured).
 */
export function isEncryptionEnabled(): boolean {
  return !!process.env.ENCRYPTION_MASTER_KEY;
}
