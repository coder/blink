import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  decryptValue,
  encryptValue,
  getMasterKey,
  isEncryptionEnabled,
} from "./encryption";

const TEST_MASTER_KEY = "test-master-key-for-encryption-should-be-secure";

describe("encryption", () => {
  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_MASTER_KEY;
    } else {
      process.env.ENCRYPTION_MASTER_KEY = originalKey;
    }
  });

  test("isEncryptionEnabled returns true when key is set", () => {
    expect(isEncryptionEnabled()).toBe(true);
  });

  test("getMasterKey returns configured key", () => {
    expect(getMasterKey()).toBe(TEST_MASTER_KEY);
  });

  test("getMasterKey returns null when not configured", () => {
    const key = process.env.ENCRYPTION_MASTER_KEY;
    delete process.env.ENCRYPTION_MASTER_KEY;

    expect(getMasterKey()).toBeNull();

    process.env.ENCRYPTION_MASTER_KEY = key;
  });

  test("encrypts and decrypts a simple string", async () => {
    const plaintext = "hello world";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);

    expect(encrypted.encryptedValue).toBeInstanceOf(Buffer);
    expect(encrypted.encryptedDEK).toBeInstanceOf(Buffer);
    expect(encrypted.encryption_iv).toBeInstanceOf(Buffer);
    expect(encrypted.encryption_auth_tag).toBeInstanceOf(Buffer);

    const decrypted = await decryptValue(encrypted, TEST_MASTER_KEY);
    expect(decrypted).toBe(plaintext);
  });

  test("encrypts and decrypts empty string", async () => {
    const plaintext = "";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);
    const decrypted = await decryptValue(encrypted, TEST_MASTER_KEY);
    expect(decrypted).toBe(plaintext);
  });

  test("encrypts and decrypts long string", async () => {
    const plaintext = "a".repeat(10000);
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);
    const decrypted = await decryptValue(encrypted, TEST_MASTER_KEY);
    expect(decrypted).toBe(plaintext);
  });

  test("encrypts and decrypts special characters", async () => {
    const plaintext = "Hello! 🎉 Special chars: @#$%^&*()[]{}|\\:;\"'<>,.?/~`";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);
    const decrypted = await decryptValue(encrypted, TEST_MASTER_KEY);
    expect(decrypted).toBe(plaintext);
  });

  test("encrypts and decrypts multiline string", async () => {
    const plaintext = `Line 1
Line 2
Line 3
With tabs\tand\nnewlines`;
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);
    const decrypted = await decryptValue(encrypted, TEST_MASTER_KEY);
    expect(decrypted).toBe(plaintext);
  });

  test("produces different encrypted values for same input", async () => {
    const plaintext = "test value";
    const encrypted1 = await encryptValue(plaintext, TEST_MASTER_KEY);
    const encrypted2 = await encryptValue(plaintext, TEST_MASTER_KEY);

    // IVs should be different
    expect(encrypted1.encryption_iv.equals(encrypted2.encryption_iv)).toBe(
      false
    );
    // Encrypted values should be different
    expect(encrypted1.encryptedValue.equals(encrypted2.encryptedValue)).toBe(
      false
    );
    // But both should decrypt to the same plaintext
    const decrypted1 = await decryptValue(encrypted1, TEST_MASTER_KEY);
    const decrypted2 = await decryptValue(encrypted2, TEST_MASTER_KEY);
    expect(decrypted1).toBe(plaintext);
    expect(decrypted2).toBe(plaintext);
  });

  test("fails to decrypt with wrong key", async () => {
    const plaintext = "secret value";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);

    await expect(decryptValue(encrypted, "wrong-master-key")).rejects.toThrow();
  });

  test("fails to decrypt with tampered encrypted value", async () => {
    const plaintext = "secret value";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);

    // Tamper with the encrypted value
    const tampered = {
      ...encrypted,
      encryptedValue: Buffer.from(
        [...encrypted.encryptedValue].map((b) => b ^ 1)
      ),
    };

    await expect(decryptValue(tampered, TEST_MASTER_KEY)).rejects.toThrow();
  });

  test("fails to decrypt with tampered DEK", async () => {
    const plaintext = "secret value";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);

    // Tamper with the encrypted DEK
    const tampered = {
      ...encrypted,
      encryptedDEK: Buffer.from([...encrypted.encryptedDEK].map((b) => b ^ 1)),
    };

    await expect(decryptValue(tampered, TEST_MASTER_KEY)).rejects.toThrow();
  });

  test("fails to decrypt with tampered auth tag", async () => {
    const plaintext = "secret value";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);

    // Tamper with the auth tag
    const tampered = {
      ...encrypted,
      encryption_auth_tag: Buffer.from(
        [...encrypted.encryption_auth_tag].map((b) => b ^ 1)
      ),
    };

    await expect(decryptValue(tampered, TEST_MASTER_KEY)).rejects.toThrow();
  });

  test("encrypted data has expected sizes", async () => {
    const plaintext = "test";
    const encrypted = await encryptValue(plaintext, TEST_MASTER_KEY);

    // IV should be 12 bytes (96 bits)
    expect(encrypted.encryption_iv.length).toBe(12);
    // Auth tag should be 16 bytes (128 bits)
    expect(encrypted.encryption_auth_tag.length).toBe(16);
    // Encrypted DEK should be salt(16) + IV(12) + authTag(16) + encryptedDEK(32) = 76 bytes
    expect(encrypted.encryptedDEK.length).toBe(76);
    // Encrypted value length should be close to plaintext length
    expect(encrypted.encryptedValue.length).toBeGreaterThanOrEqual(
      plaintext.length
    );
  });

  test("envelope encryption - DEK is different for each encryption", async () => {
    const plaintext = "test value";
    const encrypted1 = await encryptValue(plaintext, TEST_MASTER_KEY);
    const encrypted2 = await encryptValue(plaintext, TEST_MASTER_KEY);

    // Encrypted DEKs should be different (different salts/IVs)
    expect(encrypted1.encryptedDEK.equals(encrypted2.encryptedDEK)).toBe(false);
  });
});
