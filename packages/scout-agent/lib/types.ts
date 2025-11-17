import type { UIMessage } from "ai";
import type * as blink from "blink";

export type Options = {
  model: "gpt-5" | "sonnet";
  reasoningLevel?: "low" | "medium" | "high";
};

export type Message = UIMessage<{
  type: "slack";
  shared_channel: boolean;
  ext_shared_channel: boolean;
  channel_name: string;
}>;

export type Agent = blink.Agent<blink.WithUIOptions<Options, Message>>;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
