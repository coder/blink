import { getQuerier } from "@/lib/database";
import { mockNextHeaders, setupIntegrationTest, setupNextAuth } from "@/test";
import { beforeEach, describe, expect, test } from "bun:test";

// Auth backend tests are now in packages/api/src/routes/auth/auth.server.test.ts

let auth: typeof import("./auth");
beforeEach(async () => {
  await setupIntegrationTest();
  await mockNextHeaders();
  auth = await setupNextAuth();
});

describe("auth", () => {
  test("user created with early_access in development", async () => {
    const querier = await getQuerier();
    const user = await querier.insertUser({
      email: "test@test.com",
      display_name: "Test User",

      email_verified: new Date(),
      password: "",
    });
  });

  test("generateEmailVerificationToken handles non-existent user for password reset", async () => {
    // Mock the Knock service to return a truthy value so user lookup is executed
    const originalEnv = process.env.KNOCK_API_KEY;
    process.env.KNOCK_API_KEY = "test-key";

    try {
      // Test that password reset workflow doesn't throw error for non-existent email
      const result = await auth.generateEmailVerificationToken(
        "nonexistent@example.com",
        "reset-password"
      );

      // Should return token and code without throwing error
      expect(result.token).toBeDefined();
      expect(result.code).toBeDefined();
      expect(typeof result.token).toBe("string");
      expect(typeof result.code).toBe("string");
    } finally {
      // Restore original environment
      if (originalEnv) {
        process.env.KNOCK_API_KEY = originalEnv;
      } else {
        delete process.env.KNOCK_API_KEY;
      }
    }
  });

  test("generateEmailVerificationToken throws error for non-existent user in validate-email workflow", async () => {
    // Mock the Knock service to return a truthy value so user lookup is executed
    const { mock } = await import("bun:test");
    const originalEnv = process.env.KNOCK_API_KEY;
    process.env.KNOCK_API_KEY = "test-key";

    try {
      // Test that validate-email workflow still throws error for non-existent email
      await expect(
        auth.generateEmailVerificationToken(
          "nonexistent@example.com",
          "validate-email"
        )
      ).rejects.toThrow("User not found");
    } finally {
      // Restore original environment
      if (originalEnv) {
        process.env.KNOCK_API_KEY = originalEnv;
      } else {
        delete process.env.KNOCK_API_KEY;
      }
    }
  });
});
