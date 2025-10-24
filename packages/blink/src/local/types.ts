import type { UIMessage } from "ai";
import type { ID } from "../agent/types";
import type { Source } from "../react/use-logger";

export interface StoredChat {
  id: ID;
  key?: string;
  created_at: string;
  updated_at: string;
  messages: StoredMessage[];
}

export type StoredMessageMetadata = {
  __blink_internal: true;
};

export interface StoredMessage<
  T extends UIMessage = UIMessage<StoredMessageMetadata | unknown>,
> {
  readonly id: ID;
  readonly created_at: string;
  readonly metadata: T["metadata"];
  readonly parts: T["parts"];
  readonly role: T["role"];
  readonly mode: "run" | "edit";
}

/**
 * Helper to convert UIMessage to StoredMessage
 */
export const convertMessage = (
  message: UIMessage,
  mode: "run" | "edit",
  id: ID = crypto.randomUUID()
): StoredMessage => ({
  created_at: new Date().toISOString(),
  ...message,
  id,
  metadata: message.metadata as any,
  mode,
});

export function isStoredMessageMetadata(
  metadata: any
): metadata is StoredMessageMetadata {
  return (
    typeof metadata === "object" && metadata?.__blink_internal !== undefined
  );
}

export function isLogMessage(
  message: StoredMessage
): message is StoredMessage & {
  metadata: {
    __blink_log: true;
    level: "error" | "log";
    source: Source;
    message: string;
  };
} {
  return (
    typeof message.metadata === "object" &&
    message.metadata !== null &&
    "__blink_log" in message.metadata &&
    message.metadata.__blink_log === true &&
    "level" in message.metadata &&
    "source" in message.metadata &&
    "message" in message.metadata
  );
}
