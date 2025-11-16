import { test, expect, describe } from "bun:test";
import { z } from "zod";
import {
  streamText,
  simulateReadableStream,
  tool,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { MockLanguageModelV2 } from "ai/test";
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

const colorTools = {
  async_generator: tool({
    description: "Get your favorite color",
    inputSchema: z.object({}),
    async *execute() {
      yield "blue";
      await Promise.resolve();
      yield "red";
      await Promise.resolve();
      yield "green";
    },
  }),
  async: tool({
    description: "Get your favorite color",
    inputSchema: z.object({}),
    execute: async () => "green",
  }),
  sync: tool({
    description: "Get your favorite color",
    inputSchema: z.object({}),
    execute: () => "green",
  }),
} as const;

const baseMessages: ModelMessage[] = [
  { role: "user", content: "List your favorite color." },
];

const usageStub = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

const runColorTool = async (
  tools: ToolSet,
  toolName: keyof typeof colorTools,
  rawToolInput: Record<string, unknown>
) => {
  const mockModel = new MockLanguageModelV2({
    async doStream() {
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName,
              input: JSON.stringify(rawToolInput),
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: usageStub,
            },
          ],
        }),
      };
    },
  });

  const result = streamText({
    model: mockModel,
    messages: baseMessages,
    tools,
    toolChoice: { type: "tool", toolName },
  });

  return result.toolResults;
};

describe("withModelIntent", () => {
  for (const toolName of Object.keys(colorTools)) {
    test(`should handle ${toolName} tool`, async () => {
      // sanity check
      const toolResults = await runColorTool(
        colorTools,
        toolName as keyof typeof colorTools,
        {}
      );
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]?.output).toBe("green");

      const toolResultsWithModelIntent = await runColorTool(
        withModelIntent(colorTools),
        toolName as keyof typeof colorTools,
        {
          model_intent: "listing colors",
          properties: {},
        }
      );
      expect(toolResultsWithModelIntent).toHaveLength(1);
      expect(toolResultsWithModelIntent[0]?.output).toBe("green");
    });
  }
});
