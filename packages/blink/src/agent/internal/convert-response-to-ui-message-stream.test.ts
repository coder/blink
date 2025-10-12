import type { UIMessageChunk } from "ai";
import { describe, expect, test } from "bun:test";
import { StreamResponseFormatHeader } from "../client";
import type { StreamResponseFormat } from "../index.node";
import { convertResponseToUIMessageStream } from "./convert-response-to-ui-message-stream";

describe("ui message stream", () => {
  test("should default to a ui message stream", async () => {
    const response = createResponse([
      {
        id: "1",
        type: "text-delta",
        delta: "Hello, world!",
      },
    ]);
    const stream = convertResponseToUIMessageStream(response);
    const chunks = await readChunks(stream);
    expect(chunks).toEqual([
      {
        id: "1",
        type: "text-delta",
        delta: "Hello, world!",
      },
    ]);
  });
});

describe("openai-chat", () => {
  test("converts without errors", async () => {
    const response = createResponse(openaiChat, "openai-chat");
    const stream = convertResponseToUIMessageStream(response);
    const chunks = await readChunks(stream);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
  });
});

describe("openai-response", () => {
  test("converts without errors", async () => {
    const response = createResponse(openaiResponses, "openai-response");
    const stream = convertResponseToUIMessageStream(response);
    const chunks = await readChunks(stream);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
  });
});

describe("anthropic", () => {
  test("converts without errors", async () => {
    const response = createResponse(anthropic, "anthropic");
    const stream = convertResponseToUIMessageStream(response);
    const chunks = await readChunks(stream);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
  });
});

describe("google", () => {
  test("converts without errors", async () => {
    const response = createResponse(google, "google");
    const stream = convertResponseToUIMessageStream(response);
    const chunks = await readChunks(stream);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
  });
});

describe("xai", () => {
  test("converts without errors", async () => {
    const response = createResponse(xai, "xai");
    const stream = convertResponseToUIMessageStream(response);
    const chunks = await readChunks(stream);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
  });
});

const readChunks = async (stream: ReadableStream<UIMessageChunk>) => {
  const chunks: UIMessageChunk[] = [];
  await stream.pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(chunk);
      },
    })
  );
  return chunks;
};

const createResponse = (
  data: any[],
  responseFormat: StreamResponseFormat = "ui-message"
): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const item of data) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(item)}\n\n`)
          );
        }
        controller.close();
      },
    }),
    {
      headers: {
        [StreamResponseFormatHeader]: responseFormat,
        "Content-Type": "text/event-stream",
      },
    }
  );
};

const openaiChat = [
  {
    id: "chatcmpl_abc123",
    object: "chat.completion.chunk",
    created: 1726623632,
    model: "gpt-4o-mini-2024-07-18",
    system_fingerprint: "fp_123",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    usage: null,
  },
  {
    id: "chatcmpl_abc123",
    object: "chat.completion.chunk",
    created: 1726623633,
    model: "gpt-4o-mini-2024-07-18",
    system_fingerprint: "fp_123",
    choices: [
      {
        index: 0,
        delta: { content: "Hello" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    usage: null,
  },
  {
    id: "chatcmpl_abc123",
    object: "chat.completion.chunk",
    created: 1726623634,
    model: "gpt-4o-mini-2024-07-18",
    system_fingerprint: "fp_123",
    choices: [
      {
        index: 0,
        delta: { content: " world" },
        logprobs: null,
        finish_reason: null,
      },
    ],
    usage: null,
  },
  {
    id: "chatcmpl_abc123",
    object: "chat.completion.chunk",
    created: 1726623635,
    model: "gpt-4o-mini-2024-07-18",
    system_fingerprint: "fp_123",
    choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "stop" }],
    usage: null,
  },
];

const openaiResponses = [
  {
    type: "response.created",
    response: {
      id: "res_1",
      object: "response",
      status: "in_progress",
      model: "gpt-4o-mini-2024-07-18",
    },
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: {
      id: "msg_1",
      type: "message",
    },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 0,
    content_index: 0,
    delta: "Hello",
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 0,
    content_index: 0,
    delta: " world",
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      id: "msg_1",
      type: "output_text",
    },
  },
  {
    type: "response.completed",
    response: {
      id: "res_1",
      status: "completed",
      output: [{ type: "output_text", text: "Hello world", annotations: [] }],
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    },
  },
];

const anthropic = [
  {
    type: "message_start",
    message: {
      id: "msg_01FBtgoNaB3RsRB6nx8p31dX",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-3-haiku-20240307",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 181, output_tokens: 1 },
    },
  },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Hello" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: " world" },
  },
  {
    type: "content_block_stop",
    index: 0,
  },
  {
    type: "message_stop",
  },
];

const google = [
  {
    candidates: [
      {
        content: { parts: [{ text: "A T-Rex" }], role: "model" },
        finishReason: "STOP",
        index: 0,
        safetyRatings: [
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            probability: "NEGLIGIBLE",
          },
          { category: "HARM_CATEGORY_HATE_SPEECH", probability: "NEGLIGIBLE" },
          { category: "HARM_CATEGORY_HARASSMENT", probability: "NEGLIGIBLE" },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            probability: "NEGLIGIBLE",
          },
        ],
      },
    ],
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: 4,
      totalTokenCount: 15,
    },
  },
  {
    candidates: [
      {
        content: { parts: [{ text: " walks into a bar..." }], role: "model" },
        finishReason: "STOP",
        index: 0,
        safetyRatings: [
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            probability: "NEGLIGIBLE",
          },
          { category: "HARM_CATEGORY_HATE_SPEECH", probability: "NEGLIGIBLE" },
          { category: "HARM_CATEGORY_HARASSMENT", probability: "NEGLIGIBLE" },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            probability: "NEGLIGIBLE",
          },
        ],
      },
    ],
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: 21,
      totalTokenCount: 32,
    },
  },
];

const xai = [
  {
    id: "chatcmpl_123",
    object: "chat.completion.chunk",
    created: 1710000000,
    model: "grok-3",
    choices: [{ index: 0, delta: { role: "assistant", content: "Ah" } }],
    usage: {
      prompt_tokens: 41,
      completion_tokens: 1,
      total_tokens: 42,
      prompt_tokens_details: {
        text_tokens: 41,
        audio_tokens: 0,
        image_tokens: 0,
        cached_tokens: 0,
      },
    },
    system_fingerprint: "fp_xxxxxxxxxx",
  },
  {
    id: "chatcmpl_123",
    object: "chat.completion.chunk",
    created: 1710000001,
    model: "grok-3",
    choices: [{ index: 0, delta: { content: "," } }],
    usage: {
      prompt_tokens: 41,
      completion_tokens: 2,
      total_tokens: 43,
      prompt_tokens_details: {
        text_tokens: 41,
        audio_tokens: 0,
        image_tokens: 0,
        cached_tokens: 0,
      },
    },
    system_fingerprint: "fp_xxxxxxxxxx",
  },
];
