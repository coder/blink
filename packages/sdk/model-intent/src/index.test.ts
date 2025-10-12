import { test, expect } from "bun:test";
import { z } from "zod";
import { tool, type ToolSet } from "ai";
import withModelIntent from "./index";

type Properties = { foo: string; bar?: number };

type ParsedShape = { model_intent: string; properties: Properties };

const baseTools: ToolSet = {
  echo: tool({
    description: "Echoes inputs back",
    inputSchema: z.object({
      foo: z.string(),
      bar: z.number().optional(),
    }),
    execute: async (input) => input,
  }),
};

const wrapped = withModelIntent(baseTools);

const schema = (wrapped as any).echo.inputSchema as z.ZodTypeAny;

test("accepts top-level model_intent alongside properties", () => {
  const parsed = schema.parse({
    model_intent: "saving file",
    properties: { foo: "x", bar: 1 },
  }) as ParsedShape;
  expect(parsed.model_intent).toBe("saving file");
  expect(parsed.properties).toEqual({ foo: "x", bar: 1 });
});

test("accepts model_intent nested inside properties and lifts it to top-level", () => {
  const parsed = schema.parse({
    properties: { model_intent: "saving file", foo: "x", bar: 1 },
  }) as ParsedShape;
  expect(parsed.model_intent).toBe("saving file");
  expect(parsed.properties).toEqual({ foo: "x", bar: 1 });
  expect("model_intent" in parsed.properties).toBe(false);
});

test("when both are present, top-level is preserved and nested is stripped", () => {
  const parsed = schema.parse({
    model_intent: "top-level intent",
    properties: { model_intent: "nested intent", foo: "y" },
  }) as ParsedShape;
  expect(parsed.model_intent).toBe("top-level intent");
  expect(parsed.properties).toEqual({ foo: "y" });
});

test("when properties is missing, remaining keys go into properties", () => {
  const parsed = schema.parse({
    model_intent: "standalone intent",
    foo: "z",
    bar: 2,
  }) as ParsedShape;
  expect(parsed.model_intent).toBe("standalone intent");
  expect(parsed.properties).toEqual({ foo: "z", bar: 2 });
});
