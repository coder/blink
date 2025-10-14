import type { UIMessage } from "ai";
import type { Promisable } from "./internal/types";

type UIOptionIcon = `lucide:${string}` | `simple-icons:${string}`;

export type UIOptionSelectValue<ID extends string = string> = {
  readonly id: ID;
  readonly label: string;
  /**
   * description will provide additional context to the user in the UI.
   */
  readonly description?:
    | string
    | Array<{
        readonly text: string;
        readonly color?: "primary" | "muted" | "warning";
      }>;

  /**
   * icon is a slug of a Lucide or SimpleIcons icon.
   * This will only be rendered in a web-based UI.
   *
   * Find icons:
   * - https://simpleicons.org/
   * - https://lucide.dev/icons/
   */
  readonly icon?: UIOptionIcon;
};

export type UIOptionSelect<
  Values extends
    readonly UIOptionSelectValue[] = readonly UIOptionSelectValue[],
> = {
  readonly type: "select";
  /**
   * label indicates the purpose of the option.
   * If omitted, it will not be displayed in the UI.
   */
  readonly label?: string;

  /**
   * icon is a slug of a Lucide or SimpleIcons icon.
   * This will only be rendered in a web-based UI.
   *
   * Find icons:
   * - https://simpleicons.org/
   * - https://lucide.dev/icons/
   */
  readonly icon?: UIOptionIcon;

  /**
   * defaultValue is the default value for the option.
   * If omitted, the option will not be selected by default.
   */
  readonly defaultValue: Values[number]["id"];
  readonly values: Values;
};

export type UIOptions = Record<string, string>;

export type WithUIOptions<
  OPTIONS extends UIOptions,
  MESSAGE extends UIMessage = UIMessage,
> = MESSAGE & {
  readonly role: "user";
  readonly metadata: MESSAGE["metadata"] & {
    readonly options?: OPTIONS;
  };
};

// Extracts the options type from a message if it includes WithUIOptions; otherwise never.
export type ExtractUIOptions<M> =
  M extends WithUIOptions<infer O> ? O : UIOptions;

// Schema shape that matches a given options map. Enforces IDs to match the option value union.
export type UIOptionsSchema<OPTIONS extends UIOptions = UIOptions> = {
  [K in keyof OPTIONS]: UIOptionSelect<Array<UIOptionSelectValue<OPTIONS[K]>>>;
};

export interface UIEvent<MESSAGE extends UIMessage> {
  readonly selectedOptions?: ExtractUIOptions<MESSAGE>;
}

export type UIHandler<MESSAGE extends UIMessage> = (
  event: UIEvent<MESSAGE>
) => Promisable<UIOptionsSchema<ExtractUIOptions<MESSAGE>> | void>;

/**
 * lastUIOptions finds the last user message with options.
 * Options are stored in message metadata to preserve the history
 * of changing options.
 *
 * @param messages - The messages to search.
 * @returns The last user message with options, or undefined if no such message exists.
 */
export function lastUIOptions<MESSAGE extends UIMessage>(
  messages: MESSAGE[]
): ExtractUIOptions<MESSAGE> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) {
      continue;
    }
    if (message.role !== "user") {
      continue;
    }
    if (typeof message.metadata !== "object" || message.metadata === null) {
      continue;
    }
    if (!("options" in message.metadata)) {
      continue;
    }
    return message.metadata.options as unknown as ExtractUIOptions<MESSAGE>;
  }
}
