import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { createXai } from "@ai-sdk/xai";
import { streamText, type UIMessageChunk } from "ai";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { StreamResponseFormatHeader } from "../index.browser";

// This is mirrored from "blink" to avoid depending on the blink package.
export type StreamResponseFormat =
  | "ui-message"
  | "openai-chat"
  | "openai-response"
  | "anthropic"
  | "google"
  | "xai";

export function convertResponseToUIMessageStream(
  response: Response
): ReadableStream<UIMessageChunk> {
  if (!response.body) {
    throw new Error("Response body is required");
  }
  const responseFormat = response.headers.get(StreamResponseFormatHeader) as
    | StreamResponseFormat
    | undefined;
  if (!responseFormat || responseFormat === "ui-message") {
    // Default that this is already a UI message stream.
    return response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeThrough(
        new TransformStream({
          async transform(chunk, controller) {
            if (chunk.data === "[DONE]") {
              return;
            }
            try {
              const result = JSON.parse(chunk.data);
              controller.enqueue(result as UIMessageChunk);
            } catch (err) {
              controller.error(err);
              return;
            }
          },
        })
      );
  }

  const createStream = (
    model: LanguageModelV2
  ): ReadableStream<UIMessageChunk> => {
    return streamText({
      model,
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello, world!",
            },
          ],
        },
      ],
    }).toUIMessageStream();
  };

  switch (responseFormat) {
    case "openai-chat":
      return createStream(
        createOpenAI({
          apiKey: "ignored",
          // @ts-ignore
          fetch: (init, options) => {
            return response;
          },
        }).chat("fake-model")
      );
    case "openai-response":
      return createStream(
        createOpenAI({
          apiKey: "ignored",
          // @ts-ignore
          fetch: (init, options) => {
            return response;
          },
        }).responses("fake-model")
      );
    case "anthropic":
      return createStream(
        createAnthropic({
          apiKey: "ignored",
          // @ts-ignore
          fetch: (init, options) => {
            return response;
          },
        }).chat("fake-model")
      );
    case "google":
      return createStream(
        createGoogleGenerativeAI({
          apiKey: "ignored",
          // @ts-ignore
          fetch: (init, options) => {
            return response;
          },
        }).chat("fake-model")
      );
    case "xai":
      return createStream(
        createXai({
          apiKey: "ignored",
          // @ts-ignore
          fetch: (init, options) => {
            return response;
          },
        }).chat("fake-model")
      );
    default:
      throw new Error(`Unsupported response format: ${responseFormat}`);
  }
}
