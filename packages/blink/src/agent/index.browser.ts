export * from "./types";
export * from "./tools";
export * from "./ui";

export type StreamResponseFormat =
  | "ui-message"
  | "openai-chat"
  | "openai-response"
  | "anthropic"
  | "google"
  | "xai";

/**
 * StreamResponseFormatHeader indicates to a client the stream response
 * format that the agent is using.
 */
export const StreamResponseFormatHeader = "x-blink-stream-response-format";

// withResponseFormat sets the response format header on a response.
// This allows the agent to return any supported response format
// and have it be converted to a UI message stream.
export function withResponseFormat(
  response: Response,
  format: StreamResponseFormat
) {
  const headers = new Headers(response.headers);
  headers.set(StreamResponseFormatHeader, format);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
