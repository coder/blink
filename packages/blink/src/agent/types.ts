import type { InferUIMessageChunk, StreamTextResult, UIMessage } from "ai";
import type { Promisable } from "./internal/types";

/**
 * ID is a UUID.
 * This is a special type to ensure that keys are not passed as IDs.
 */
export type ID = `${string}-${string}-${string}-${string}-${string}`;

export interface NewMessage<MESSAGE extends UIMessage> {
  /**
   * ID must be a UUID. If not set, a random UUID will be generated.
   *
   * String is allowed for nice types - users may define messages as UIMessage,
   * which this type fulfills.
   */
  readonly id?: ID | string;

  /**
   * createdAt is the timestamp of the message.
   *
   * If not set, the message will be created at the current time.
   */
  readonly createdAt?: Date;
  readonly role: MESSAGE["role"];
  readonly parts: MESSAGE["parts"];
  readonly metadata?: MESSAGE["metadata"];
}

export interface Chat {
  readonly id: ID;
  readonly createdAt: string;
}

export interface UpsertedChat extends Chat {
  readonly created: boolean;
}

export type SendBehavior = "enqueue" | "interrupt" | "append";

export interface SendOptions {
  /**
   * behavior of the chat when sending these messages.
   *
   * - "enqueue" will add messages to the chat and start the chat eventually.
   * - "interrupt" will interrupt the chat if running and send messages.
   * - "append" will add messages to the chat.
   */
  readonly behavior?: SendBehavior;

  /**
   * upsert will replace messages in the chat if they already exist.
   */
  readonly upsert?: boolean;
}

export interface ChatEvent<MESSAGE extends UIMessage> {
  readonly id: ID;
  readonly messages: MESSAGE[];
  readonly abortSignal?: AbortSignal;
}

export type ChatResponse<MESSAGE extends UIMessage> =
  | {
      toUIMessageStream: StreamTextResult<any, any>["toUIMessageStream"];
    }
  | Response
  | ReadableStream<InferUIMessageChunk<MESSAGE>>
  | void;

export type ChatHandler<MESSAGE extends UIMessage> = (
  event: ChatEvent<MESSAGE>
) => Promisable<ChatResponse<MESSAGE>>;

export interface AgentChat<MESSAGE extends UIMessage = UIMessage> {
  /**
   * Upsert a chat by a stable key.
   * This will create a new chat if it doesn't exist.
   *
   * @param key the key of the chat.
   */
  upsert(key: JSONValue): Promise<UpsertedChat>;

  /**
   * Get a chat by ID.
   *
   * @param id the ID of the chat.
   * @returns the chat.
   */
  get(id: ID): Promise<Chat | undefined>;

  /**
   * Get messages from a chat.
   *
   * @param id the ID of the chat.
   * @returns the messages in the chat.
   */
  getMessages(id: ID): Promise<MESSAGE[]>;

  /**
   * Send messages to a chat.
   *
   * @param id the ID of the chat.
   * @param messages the messages to send.
   * @param options the options for the messages.
   */
  sendMessages(
    id: ID,
    messages: NewMessage<MESSAGE>[],
    options?: SendOptions
  ): Promise<void>;

  /**
   * Delete messages from a chat.
   *
   * @param id the ID of the chat.
   * @param messages the messages to delete.
   */
  deleteMessages(id: ID, messages: string[]): Promise<void>;

  /**
   * Start a chat.
   *
   * @param id the ID of the chat.
   */
  start(id: ID): Promise<void>;

  /**
   * Stop a chat.
   *
   * @param id the ID of the chat.
   */
  stop(id: ID): Promise<void>;

  /**
   * Reset a chat.
   *
   * @param id the ID of the chat.
   */
  reset(id: ID): Promise<void>;

  /**
   * Delete a chat.
   *
   * @param id the ID of the chat.
   */
  delete(id: ID): Promise<void>;
}

export interface AgentStore {
  /**
   * get retrieves a value from storage.
   *
   * @param key the key of the value.
   * @returns the value.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * set a value.
   *
   * @param key the key of the value.
   * @param value the value to set.
   */
  set(
    key: string,
    value: string,
    options?: {
      /**
       * ttl is the number of seconds to keep the value.
       *
       * If not set, the value will never expire.
       */
      ttl?: number;
    }
  ): Promise<void>;

  /**
   * delete a value.
   *
   * @param key the key of the value.
   */
  delete(key: string): Promise<void>;

  /**
   * list all values by prefix.
   *
   * @param prefix the prefix of the keys.
   * @returns the values.
   */
  list(
    prefix?: string,
    options?: {
      /**
       * limit is the maximum number of values to return.
       *
       * Defaults to 100. Limit is 1000.
       */
      limit?: number;

      /**
       * cursor is the cursor to start from.
       *
       * If not set, the list will start from the beginning.
       */
      cursor?: string;
    }
  ): Promise<{
    entries: Array<{
      key: string;
      ttl?: number;
    }>;
    cursor?: string;
  }>;
}

export interface AgentOtel {
  /**
   * traces forwards OpenTelemetry traces.
   */
  traces: (request: Request) => Promise<Response>;
}

/**
A JSON value can be a string, number, boolean, object, array, or null.
JSON values can be serialized and deserialized by the JSON.stringify and JSON.parse methods.
 */
type JSONValue = null | string | number | boolean | JSONObject | JSONArray;
type JSONObject = {
  [key: string]: JSONValue;
};
type JSONArray = Array<JSONValue | undefined>;
