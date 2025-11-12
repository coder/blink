// This should not be exported via index.ts because it's only
// for interfacting with the agent's HTTP API.
//
// This is imported from `blink/client`.

import type { UIMessage, UIMessageChunk } from "ai";
import type { EventSourceMessage } from "eventsource-parser/stream";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { hc } from "hono/client";
import type { api } from "../agent";
import { convertResponseToUIMessageStream } from "../internal/convert-response-to-ui-message-stream";
import type { ID } from "../types";
import type { UIOptions, UIOptionsSchema } from "../ui";
import { APIServerURLEnvironmentVariable } from "../constants";
import { RWLock } from "../../local/rw-lock";

export { APIServerURLEnvironmentVariable };

export { StreamResponseFormatHeader } from "../index.browser";

export interface ClientOptions {
  readonly baseUrl: string;
  readonly headers?: Record<string, string>;
}

export type CapabilitiesResponse = Awaited<ReturnType<Client["capabilities"]>>;

/**
 * Client is a client for the Blink agent HTTP API.
 */
export class Client {
  public readonly baseUrl: string;
  private readonly client: ReturnType<typeof hc<typeof api>>;

  public constructor(options: ClientOptions) {
    this.client = hc<typeof api>(options.baseUrl);
    this.baseUrl = options.baseUrl;
  }

  /**
   * chat starts chatting with the agent.
   */
  public async chat(
    request: {
      id: ID;
      messages: UIMessage[];
    },
    options?: { signal?: AbortSignal; headers?: Record<string, string> }
  ): Promise<ReadableStream<UIMessageChunk>> {
    const response = await this.client._agent.chat.$post(
      {
        json: request,
      },
      {
        headers: options?.headers,
        init: {
          signal: options?.signal,
        },
      }
    );
    if (!response.ok) {
      await this.handleError(response);
    }
    return convertResponseToUIMessageStream(response);
  }

  /**
   * capabilities returns the capabilities of the agent.
   * This is used to check if the agent supports requests and completions.
   */
  public async capabilities() {
    const response = await this.client._agent.capabilities.$get();
    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json();
  }

  public async ui(
    request: {
      selectedOptions?: UIOptions;
    },
    options?: { signal?: AbortSignal }
  ): Promise<UIOptionsSchema | undefined> {
    const response = await this.client._agent.ui.$get(
      {
        query: request.selectedOptions
          ? {
              selected_options: JSON.stringify(request.selectedOptions),
            }
          : {},
      },
      {
        init: {
          signal: options?.signal,
        },
      }
    );
    if (!response.ok || response.status !== 200) {
      if (response.status === 404) {
        // This means there is no UI schema.
        return undefined;
      }
      await this.handleError(response);
    }
    return response.json() as unknown as UIOptionsSchema;
  }

  /**
   * health simply returns a 200 response.
   * This is used to check if the agent is running.
   */
  public async health() {
    const response = await this.client._agent.health.$get();
    if (!response.ok) {
      await this.handleError(response);
    }
  }

  private async handleError(response: Response): Promise<never> {
    let body: string | undefined;
    try {
      body = await response.text();
    } catch (err) {}
    if (body) {
      let parsed: { error: string } | undefined;
      try {
        parsed = JSON.parse(body);
      } catch (err) {}
      if (parsed) {
        throw new Error(parsed.error);
      }
      throw new Error(`Failed (${response.status}): ${body}`);
    }
    throw new Error(`Failed (${response.status}): ${response.statusText}`);
  }
}

export const streamSSE = <T>(resp: Response): ReadableStream<T> => {
  const parser = new EventSourceParserStream();
  if (!resp.body) {
    throw new Error("The stream endpoint did not return a body!");
  }
  resp.body
    .pipeThrough(new TextDecoderStream())
    .pipeTo(parser.writable)
    .catch((err) => {
      // It's all chill - the stream is just going to end.
    });
  return createEventStreamFromReadable<T>(parser.readable);
};

const createEventStreamFromReadable = <T>(
  readable: ReadableStream<EventSourceMessage>
): ReadableStream<T> => {
  const transformedStream = readable.pipeThrough(
    new TransformStream<EventSourceMessage, T>({
      async transform(chunk, controller) {
        try {
          const result = JSON.parse(chunk.data);
          controller.enqueue(result as T);
        } catch (err) {
          controller.error(err);
          return;
        }
      },
    })
  );

  return transformedStream;
};
