import type { UIMessage } from "ai";

export interface SlackMessageMetadata {
  type: "slack";
  shared_channel: boolean;
  ext_shared_channel: boolean;
  channel_name: string;
  is_external_user: boolean;
}

export type Message<
  T extends Record<string, unknown> = Record<string, unknown>,
> = UIMessage<SlackMessageMetadata | T>;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
