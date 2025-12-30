import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { MESSAGE_LIMITS } from "../constants";
import { serve } from "../test";
import { validateMessageSizes } from "./messages.server";

test("CRUD /api/messages", async () => {
  const { helpers } = await serve();
  const { client } = await helpers.createUser();

  const org = await client.organizations.create({
    name: "test-org",
  });

  const agent = await client.agents.create({
    organization_id: org.id,
    name: "test-agent",
  });

  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    entrypoint: "test.js",
    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
      },
    ],
  });
  await client.agents.update({
    id: agent.id,
    active_deployment_id: deployment.id,
  });

  const chat = await client.chats.create({
    organization_id: org.id,
    agent_id: agent.id,
  });

  // Send a message.
  const sendResp = await client.messages.send({
    chat_id: chat.id,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "Hello, world!" }],
        metadata: {
          foo: "bar",
        },
      },
    ],
  });
  expect(sendResp.messages.length).toBe(1);
  const created = sendResp.messages[0]!;
  expect(created.chat_id).toBe(chat.id);
  expect(created.role).toBe("user");
  expect(created.parts[0]).toEqual({ type: "text", text: "Hello, world!" });
  expect(created.metadata).toEqual({ foo: "bar" });

  // List messages.
  let list = await client.messages.list({
    chat_id: chat.id,
  });
  expect(list.items.length).toBe(1);
  expect(list.items[0]).toEqual(created);
  expect(list.next_cursor).toBeNull();

  await client.messages.update({
    message_id: created.id,
    role: "assistant" as const,
    parts: [{ type: "text", text: "Updated" }],
    metadata: { baz: "qux" },
  });

  // Verify the update via list.
  list = await client.messages.list({ chat_id: chat.id });
  expect(list.items.length).toBe(1);
  const updated = list.items[0]!;
  expect(updated.id).toBe(created.id);
  expect(updated.role).toBe("assistant");
  expect(updated.parts[0]).toEqual({ type: "text", text: "Updated" });
  expect(updated.metadata).toEqual({ baz: "qux" });

  // Delete the message.
  await client.messages.delete(updated.id);

  // List again.
  list = await client.messages.list({ chat_id: chat.id });
  expect(list.items.length).toBe(0);
  expect(list.next_cursor).toBeNull();
});

describe("validateMessageSizes", () => {
  test("accepts valid small messages", () => {
    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts: [
            { type: "text", text: "Hello world" },
            { type: "text", text: "How are you?" },
          ],
        },
      ])
    ).not.toThrow();
  });

  test("rejects message with too many parts", () => {
    const parts = Array.from(
      { length: MESSAGE_LIMITS.MAX_PARTS_PER_MESSAGE + 1 },
      (_, i) => ({
        type: "text" as const,
        text: `Part ${i}`,
      })
    );

    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts,
        },
      ])
    ).toThrow(HTTPException);
  });

  test("rejects file with oversized data URL", () => {
    const size = MESSAGE_LIMITS.MAX_PART_SIZE_BYTES + 1024;
    const data = "A".repeat(size);
    const base64 = Buffer.from(data).toString("base64");
    const dataUrl = `data:text/plain;base64,${base64}`;

    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "text/plain",
              url: dataUrl,
            },
          ],
        },
      ])
    ).toThrow(HTTPException);
  });

  test("accepts file with data URL under size limit", () => {
    const data = "Hello, this is a small file";
    const base64 = Buffer.from(data).toString("base64");
    const dataUrl = `data:text/plain;base64,${base64}`;

    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "text/plain",
              url: dataUrl,
            },
          ],
        },
      ])
    ).not.toThrow();
  });

  test("rejects single part that is too large", () => {
    const hugeText = "X".repeat(MESSAGE_LIMITS.MAX_PART_SIZE_BYTES + 1024);

    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: hugeText,
            },
          ],
        },
      ])
    ).toThrow(HTTPException);
  });

  test("rejects message where total size exceeds limit", () => {
    const partSize = MESSAGE_LIMITS.MAX_MESSAGE_SIZE_BYTES / 10;
    const parts = Array.from({ length: 12 }, (_, i) => ({
      type: "text" as const,
      text: "X".repeat(partSize),
    }));

    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts,
        },
      ])
    ).toThrow(HTTPException);
  });

  test("accepts hosted file URLs without size checking", () => {
    expect(() =>
      validateMessageSizes([
        {
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "image/png",
              url: "https://example.com/huge-file.png",
            },
          ],
        },
      ])
    ).not.toThrow();
  });

  test("provides helpful error message for oversized data URL", () => {
    const size = MESSAGE_LIMITS.MAX_PART_SIZE_BYTES + 1024;
    const data = "A".repeat(size);
    const base64 = Buffer.from(data).toString("base64");
    const dataUrl = `data:text/plain;base64,${base64}`;

    try {
      validateMessageSizes([
        {
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "text/plain",
              url: dataUrl,
            },
          ],
        },
      ]);
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      if (error instanceof HTTPException) {
        expect(error.status).toBe(413);
        expect(error.message).toContain("File data URL is too large");
        expect(error.message).toContain("/api/files");
      }
    }
  });
});
