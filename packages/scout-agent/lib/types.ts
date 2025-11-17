import type { UIMessage } from "ai";

export type Message = UIMessage<{
  type: "slack";
  shared_channel: boolean;
  ext_shared_channel: boolean;
  channel_name: string;
}>;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
