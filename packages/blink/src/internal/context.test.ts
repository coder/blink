import { describe, expect, test } from "bun:test";
import { getAuthToken, runWithAuth, requestContext } from "./context";

describe("AsyncLocalStorage auth context", () => {
  test("getAuthToken returns undefined outside of runWithAuth", () => {
    expect(getAuthToken()).toBeUndefined();
  });

  test("getAuthToken returns token inside runWithAuth", () => {
    runWithAuth("test-token", () => {
      expect(getAuthToken()).toBe("test-token");
    });
  });

  test("nested runWithAuth uses inner token", () => {
    runWithAuth("outer-token", () => {
      expect(getAuthToken()).toBe("outer-token");
      runWithAuth("inner-token", () => {
        expect(getAuthToken()).toBe("inner-token");
      });
      // After inner context exits, outer token is restored
      expect(getAuthToken()).toBe("outer-token");
    });
  });

  test("async operations preserve context", async () => {
    await runWithAuth("async-token", async () => {
      expect(getAuthToken()).toBe("async-token");
      await Promise.resolve();
      expect(getAuthToken()).toBe("async-token");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getAuthToken()).toBe("async-token");
    });
  });

  test("concurrent requests have isolated contexts", async () => {
    // This test simulates concurrent requests where each has its own token
    const results: string[] = [];

    const request1 = runWithAuth("token-A", async () => {
      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 20));
      results.push(`request1: ${getAuthToken()}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      results.push(`request1-after: ${getAuthToken()}`);
    });

    const request2 = runWithAuth("token-B", async () => {
      // Simulate some async work (shorter delay to interleave)
      await new Promise((resolve) => setTimeout(resolve, 5));
      results.push(`request2: ${getAuthToken()}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      results.push(`request2-after: ${getAuthToken()}`);
    });

    await Promise.all([request1, request2]);

    // Each request should see its own token, despite concurrent execution
    expect(results).toContain("request1: token-A");
    expect(results).toContain("request1-after: token-A");
    expect(results).toContain("request2: token-B");
    expect(results).toContain("request2-after: token-B");
  });

  test("context is not shared between parallel promises", async () => {
    const tokens: string[] = [];

    // Simulate multiple concurrent requests
    const requests = Array.from({ length: 10 }, (_, i) =>
      runWithAuth(`token-${i}`, async () => {
        // Random delay to increase chance of interleaving
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        const token = getAuthToken();
        tokens.push(`${i}:${token}`);
        return token;
      })
    );

    const results = await Promise.all(requests);

    // Each request should have received its own token
    results.forEach((result, i) => {
      expect(result).toBe(`token-${i}`);
    });
  });

  test("requestContext.getStore() returns the context object", () => {
    expect(requestContext.getStore()).toBeUndefined();

    runWithAuth("context-test", () => {
      const store = requestContext.getStore();
      expect(store).toBeDefined();
      expect(store?.authToken).toBe("context-test");
    });
  });
});
