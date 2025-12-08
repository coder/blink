import { describe, expect, it } from "bun:test";
import { assertResponseStatus } from "./client-helper";

describe("assertResponseStatus", () => {
  it("should not throw when status matches", async () => {
    const response = new Response("", { status: 200 });
    await expect(assertResponseStatus(response, 200)).resolves.toBeUndefined();
  });

  it("should throw clean error message when response has message field", async () => {
    const response = new Response(
      JSON.stringify({ message: "That name is already taken!" }),
      { status: 400 }
    );

    await expect(assertResponseStatus(response, 201)).rejects.toThrow(
      "That name is already taken!"
    );
  });

  it("should include details in error cause when present", async () => {
    const response = new Response(
      JSON.stringify({
        message: "Validation failed",
        details: { field: "name", issue: "too short" },
      }),
      { status: 400 }
    );

    try {
      await assertResponseStatus(response, 201);
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Validation failed");
      expect((err as Error).cause).toEqual({
        field: "name",
        issue: "too short",
      });
    }
  });

  it("should throw full error when response is not valid JSON", async () => {
    const response = new Response("Not JSON", { status: 500 });

    await expect(assertResponseStatus(response, 200)).rejects.toThrow(
      "Expected status 200, got 500: Not JSON"
    );
  });

  it("should throw full error when JSON has no message field", async () => {
    const response = new Response(JSON.stringify({ error: "Something" }), {
      status: 400,
    });

    await expect(assertResponseStatus(response, 200)).rejects.toThrow(
      'Expected status 200, got 400: {"error":"Something"}'
    );
  });
});
