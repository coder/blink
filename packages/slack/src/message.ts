import type {
  AnyBlock,
  // AppMentionEvent,
  GenericMessageEvent,
  RichTextChannelMention,
  RichTextTeamMention,
  RichTextUsergroupMention,
  RichTextUserMention,
} from "@slack/types";
import type {
  ConversationsHistoryResponse,
  ConversationsInfoResponse,
  TeamInfoResponse,
  UsersInfoResponse,
  WebClient,
} from "@slack/web-api";
import type { AssistantAppThreadBlock } from "@slack/web-api/dist/types/response/ChatPostMessageResponse";
import type { UIMessage } from "ai";
import type { KnownEventFromType } from "@slack/bolt";

/**
 * Helps LLMs format messages for Slack.
 *
 * @param text - The text to format.
 * @returns The formatted text.
 */
export function formatMessage(text: string): string {
  const maxLength = 3000;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }

  // Manual formatting fixes for Slack compatibility
  // Convert markdown links [text](url) to Slack format <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert double star bold **text** to single star *text*
  text = text.replace(/\*\*([^*]+)\*\*/g, "*$1*");

  // Replace non-bracketed user IDs with Slack format <@user_id>
  // Only wrap when not already inside angle brackets
  text = text.replace(
    /(?<!<)@(U|W)[A-Z0-9]{8,}(?!>)/g,
    (match) => `<${match}>`
  );

  // Also handle bare user IDs that start with U or W (LLMs often omit @ and <>)
  // Ensure we don't match within a larger alphanumeric token and avoid already bracketed forms
  text = text.replace(
    /(^|[^A-Z0-9<@])((?:U|W)[A-Z0-9]{8,})(?![A-Z0-9>])/g,
    (m, prefix, id) => `${prefix}<@${id}>`
  );

  // If the model emitted <@handle> (not a Slack ID like U... or W...), remove brackets so it renders as plain @handle
  text = text.replace(/<@([a-z0-9._-]+)>/gi, (m, u) =>
    /^[UW][A-Z0-9]{8,}$/.test(u) ? m : `@${u}`
  );

  return text;
}

/**
 * formattingRules to provide to LLMs that guide them on how to format messages for Slack.
 */
export const formattingRules = `FORMATTING RULES:
- *text* = bold (NOT italics like in standard markdown)
- _text_ = italics  
- \`text\` = inline code
- \`\`\` = code blocks (do NOT put a language after the backticks)
- ~text~ = strikethrough
- <http://example.com|link text> = links
- tables must be in a code block
- user mentions must be in the format <@user_id> (e.g. <@U01UBAM2C4D>)

NEVER USE:
- Headings (#, ##, ###, etc.)
- Double asterisks (**text**) - Slack doesn't support this
- Standard markdown bold/italic conventions`;

/**
 * These are the Slack event types that we currently support for automatically creating messages from events.
 * The list is not exhaustive - we may want to add more in the future.
 */
type SlackEventType =
  | "app_mention"
  | "assistant_thread_started"
  | "file_shared"
  | "link_shared"
  | "member_joined_channel"
  | "message"
  | "reaction_added"
  | "reaction_removed";

/**
 * CreateMessageFromEventOptions extends ExtractMessageDetailsFromEventOptions.
 *
 * It exists so we can add options in the future.
 * Feel free to use `extractMessageDetailsFromEvent` to construct your own message.
 */
export interface CreateMessageFromEventOptions
  extends Omit<ExtractMessagesMetadataOptions<SlackEventType>, "messages"> {
  event: KnownEventFromType<SlackEventType>;
}

export interface CreateMessageFromEventResult {
  message: UIMessage;
  metadata: MessageMetadata;
}

/**
 * createMessageFromEvent creates a message from a Slack event.
 *
 * It just wraps `extractMessageMetadataFromEvent` and calls `createPartsFromMessageMetadata`.
 *
 * Feel free to extract metadata and construct parts yourself for full customization.
 */
export const createMessageFromEvent = async (
  options: CreateMessageFromEventOptions
): Promise<CreateMessageFromEventResult> => {
  const id =
    ("client_msg_id" in options.event
      ? options.event.client_msg_id
      : undefined) ?? crypto.randomUUID();

  const [botInfo, [response]] = await Promise.all([
    options.client.auth
      .test()
      .then((res) => {
        if (!res.ok) {
          return undefined;
        }
        return res;
      })
      .catch(() => undefined),
    extractMessagesMetadata({
      client: options.client,
      messages: [
        {
          ...options.event,
          files:
            "files" in options.event
              ? (options.event.files as GenericMessageEvent["files"])
              : undefined,
        },
      ],
      supportedFileTypes: options.supportedFileTypes,
      maxFileSize: options.maxFileSize,
    }),
  ]);
  if (!response) {
    throw new Error("Failed to extract message metadata");
  }
  let message: CreatePartsFromMessageMetadataOptions["message"];
  switch (options.event.type) {
    case "assistant_thread_started":
      message = {
        channel: options.event.assistant_thread.channel_id,
        thread_ts: options.event.assistant_thread.thread_ts,
        ts: options.event.event_ts,
      };
      break;
    case "file_shared":
      message = {
        channel: options.event.channel_id,
        ts: options.event.event_ts,
      };
      break;
    case "reaction_added":
      message = {
        channel: options.event.item.channel,
        ts: options.event.event_ts,
      };
      break;
    case "reaction_removed":
      message = {
        channel: options.event.item.channel,
        ts: options.event.event_ts,
      };
      break;
    default:
      message = options.event;
      break;
  }
  const parts = createPartsFromMessageMetadata({
    metadata: response.metadata,
    botUserId: botInfo?.user_id,
    message,
  });

  return {
    message: {
      id,
      parts,
      role: "user",
    },
    metadata: response.metadata,
  };
};

export interface CreatePartsFromMessageMetadataOptions {
  message: {
    channel?: string;
    ts?: string;
    thread_ts?: string;
    text?: string;
  };

  metadata: MessageMetadata;

  /**
   * botUserId can be supplied to help the bot identify itself.
   */
  botUserId?: string;
}

/**
 * createPartsFromMessageMetadata creates UIMessage parts from message metadata.
 *
 * This provides files, mentions, and sender information.
 */
export const createPartsFromMessageMetadata = ({
  metadata,
  botUserId,
  message,
}: CreatePartsFromMessageMetadataOptions): UIMessage["parts"] => {
  const parts: UIMessage["parts"] = [];

  let shouldRespondInThread = Boolean(
    metadata.mentions.find(
      (mention) => mention.type === "user" && mention.user.id === botUserId
    )
  );
  if (metadata.channel?.is_im || metadata.channel?.is_mpim) {
    shouldRespondInThread = false;
  }

  parts.push(
    {
      type: "text",
      text: `You *must* respond by sending a Slack message. Slack message metadata (use for responding and reacting):

Timestamp Formatted: ${metadata.createdAt.toLocaleString()}
Timestamp Raw: ${message.ts ?? "N/A"}
Thread Timestamp: ${message.thread_ts ?? "N/A"}
Channel ID: ${message.channel ?? "N/A"}
${metadata.user ? `From User: ${metadata.user.name} (<@${metadata.user.id ?? "N/A"}>) (${metadata.user.real_name ?? metadata.user.profile?.display_name ?? "N/A"})` : ""}
`,
    },
    {
      type: "text",
      text: shouldRespondInThread
        ? "You *must* reply with using the message's timestamp."
        : "You *may* reply with using the message's timestamp or directly to the channel.",
    },
    {
      type: "text",
      text: `Slack Message Content:
${message.text ?? ""}`,
    }
  );

  const text: string[] = [];
  for (const mention of metadata.mentions) {
    switch (mention.type) {
      case "channel":
        text.push(`Channel: ${mention.id} => ${mention.channel.name}`);
        break;
      case "team":
        text.push(`Team: ${mention.id} => ${mention.team.name}`);
        break;
      case "user":
        if (mention.id === botUserId) {
          text.push(
            `Bot (this is you!): ${mention.id} => ${mention.user.name} (${mention.user.real_name ?? mention.user.profile?.display_name ?? "N/A"})`
          );
        } else if (mention.user.is_bot) {
          text.push(
            `Bot: ${mention.id} => ${mention.user.name} (${mention.user.real_name ?? mention.user.profile?.display_name ?? "N/A"})`
          );
        } else {
          text.push(
            `User: ${mention.id} => ${mention.user.name} (${mention.user.real_name ?? mention.user.profile?.display_name ?? "N/A"})`
          );
        }
        break;
    }
  }
  parts.push({
    type: "text",
    text: `Mentions found in the message:
${text.join("\n")}

Use these mentions to tag channels, teams, and users if relevant.
Be sure to use the <@id> format for mentions.`,
  });

  for (const file of metadata.files) {
    if (file.result.type === "downloaded") {
      const base64 = Buffer.from(file.result.content).toString("base64");
      parts.push({
        type: "file",
        url: `data:${file.file.mimetype};base64,${base64}`,
        mediaType: file.file.mimetype,
      });
    } else if (file.result.type === "error") {
      parts.push({
        type: "text",
        text: `The user attached file ${file.file.name}, but it could not be downloaded. Error: ${file.result.error.message}`,
      });
    } else if (file.result.type === "too_large") {
      parts.push({
        type: "text",
        text: `The user attached file ${file.file.name}, but it was too large (${file.result.size} bytes) to download.`,
      });
    } else if (file.result.type === "not_supported") {
      parts.push({
        type: "text",
        text: `The user attached file ${file.file.name}, but the file type (${file.file.mimetype}) is not supported.`,
      });
    } else if (file.result.type === "no_url") {
      parts.push({
        type: "text",
        text: `The user attached file ${file.file.name}, but no download URL was available.`,
      });
    } else {
      parts.push({
        type: "text",
        text: `The user attached file ${file.file.name}, but it was not downloaded.`,
      });
    }
  }

  return parts;
};

export interface MessageMetadata {
  /**
   * mentions is a list of mentions in the message.
   */
  mentions: Array<
    | {
        type: "channel";
        id: string;
        channel: NonNullable<ConversationsInfoResponse["channel"]>;
      }
    | {
        type: "team";
        id: string;
        team: NonNullable<TeamInfoResponse["team"]>;
      }
    | {
        type: "user";
        id: string;
        user: NonNullable<UsersInfoResponse["user"]>;
      }
  >;

  /**
   * files is a list of files attached to the message.
   */
  files: Array<{
    file: NonNullable<GenericMessageEvent["files"]>[number];
    // Content will only be fetched if the file is in the supportedFileTypes.
    result:
      | {
          type: "downloaded";
          content: Buffer;
        }
      | {
          type: "not_supported";
        }
      | {
          type: "too_large";
          size: number;
        }
      | {
          type: "error";
          error: Error;
        }
      | {
          type: "no_url";
        };
  }>;

  /**
   * user is the user who sent the message.
   */
  user: UsersInfoResponse["user"];

  /**
   * createdAt is the timestamp of the message.
   */
  createdAt: Date;

  /**
   * channel is the channel the message was sent in.
   */
  channel: ConversationsInfoResponse["channel"];
}

export interface ExtractMessagesMetadataOptions<T> {
  readonly client: WebClient;
  readonly messages: T[];

  /**
   * supportedFileTypes is a list of file types that the client
   * will attempt to download and attach to the message.
   *
   * Defaults to `defaultSupportedFileTypes`.
   */
  readonly supportedFileTypes?: string[];

  /**
   * maxFileSize is the maximum file size in bytes that the client
   * will attempt to download and attach to the message.
   *
   * By default, this is 10MB.
   *
   * If the file is larger than this, it will not be attached to the message.
   */
  readonly maxFileSize?: number;
}

export type ExtractMessagesMetadataResult<T> = Array<{
  message: T;
  metadata: MessageMetadata;
}>;

/**
 * extractMessagesMetadata extracts metadata from messages.
 *
 * - User/team/channel mentions
 * - File attachments
 * - Sender information
 * - Timestamp
 */
export const extractMessagesMetadata = async <
  T extends {
    blocks?: AnyBlock[] | AssistantAppThreadBlock[];
    files?: Array<{
      mimetype?: string;
      size?: number;
      url_private?: string;
      name?: string | null;
    }>;
    user?: string;
    ts?: string;
    channel?: string;
  },
>({
  client,
  messages,
  supportedFileTypes = defaultSupportedFileTypes,
  maxFileSize = 10 * 1024 * 1024,
}: ExtractMessagesMetadataOptions<T>): Promise<
  ExtractMessagesMetadataResult<T>
> => {
  // Collect all unique IDs to fetch in batch
  const channelIds = new Set<string>();
  const teamIds = new Set<string>();
  const userIds = new Set<string>();
  const fileUrls: Array<{
    url?: string;
    file: NonNullable<GenericMessageEvent["files"]>[number];
    messageIndex: number;
    reason?:
      | { type: "no_url" }
      | { type: "too_large"; size: number }
      | { type: "not_supported" };
  }> = [];

  // First pass: collect all IDs and files from all messages
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    // Collect channel ID from message
    if (message.channel) {
      channelIds.add(message.channel);
    }

    // Extract mentions from blocks
    if (message.blocks && Array.isArray(message.blocks)) {
      const mentions = extractMentionsFromMessageBlocks(
        message.blocks as AnyBlock[]
      );
      for (const mention of mentions) {
        switch (mention.type) {
          case "channel":
            channelIds.add(mention.channel_id);
            break;
          case "team":
            teamIds.add(mention.team_id);
            break;
          case "user":
            userIds.add(mention.user_id);
            break;
        }
      }
    }

    // Collect user IDs from message authors
    if (message.user) {
      userIds.add(message.user);
    }

    // Collect files
    const messageFiles = message.files as GenericMessageEvent["files"];
    if (messageFiles) {
      for (const file of messageFiles) {
        if (!file.url_private) {
          fileUrls.push({
            file,
            messageIndex: i,
            reason: { type: "no_url" },
          });
        } else if (!file.size || file.size > maxFileSize) {
          fileUrls.push({
            file,
            messageIndex: i,
            reason: { type: "too_large", size: file.size ?? 0 },
          });
        } else if (
          !file.mimetype ||
          !supportedFileTypes.includes(file.mimetype)
        ) {
          fileUrls.push({
            file,
            messageIndex: i,
            reason: { type: "not_supported" },
          });
        } else {
          fileUrls.push({
            url: file.url_private,
            file,
            messageIndex: i,
          });
        }
      }
    }
  }

  // Fetch all data in parallel
  const promises: Promise<void>[] = [];

  // Fetch channel info
  const channelPromises: Record<
    string,
    Promise<ConversationsInfoResponse["channel"] | undefined>
  > = {};
  for (const channelId of channelIds) {
    channelPromises[channelId] = client.conversations
      .info({ channel: channelId })
      .then((res) => res.channel)
      .catch(() => undefined);
  }

  // Fetch team info
  const teamPromises: Record<
    string,
    Promise<TeamInfoResponse["team"] | undefined>
  > = {};
  for (const teamId of teamIds) {
    teamPromises[teamId] = client.team
      .info({ team: teamId })
      .then((res) => res.team)
      .catch(() => undefined);
  }

  // Fetch user info
  const userPromises: Record<
    string,
    Promise<UsersInfoResponse["user"] | undefined>
  > = {};
  for (const userId of userIds) {
    userPromises[userId] = client.users
      .info({ user: userId })
      .then((res) => res.user)
      .catch(() => undefined);
  }

  // Fetch files
  const fileResults: Map<
    number, // messageIndex
    Map<string, MessageMetadata["files"][number]> // file.id -> result
  > = new Map();

  for (const entry of fileUrls) {
    const { file, messageIndex, url, reason } = entry;

    // Ensure messageIndex map exists
    if (!fileResults.has(messageIndex)) {
      fileResults.set(messageIndex, new Map());
    }
    const messageFiles = fileResults.get(messageIndex)!;

    if (reason) {
      // File has a reason why it can't be downloaded
      messageFiles.set(file.id, {
        file,
        result: reason,
      });
    } else if (url) {
      // Download the file
      promises.push(
        (async () => {
          try {
            const response = await fetch(url, {
              headers: {
                Authorization: `Bearer ${client.token}`,
              },
              redirect: "follow",
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(text);
            }
            if (response.headers.get("content-type") !== file.mimetype) {
              throw new Error(
                `The file ${file.name} mime type returned by the server was ${response.headers.get("content-type")}.`
              );
            }
            const content = await response.arrayBuffer();
            messageFiles.set(file.id, {
              file,
              result: {
                type: "downloaded",
                content: Buffer.from(content),
              },
            });
          } catch (err) {
            messageFiles.set(file.id, {
              file,
              result: {
                type: "error",
                error: err as Error,
              },
            });
          }
        })()
      );
    }
  }

  // Wait for all promises to resolve
  await Promise.all([
    ...promises,
    ...Object.values(channelPromises),
    ...Object.values(teamPromises),
    ...Object.values(userPromises),
  ]);

  // Resolve all promises to get the actual data
  const channels: Record<string, ConversationsInfoResponse["channel"]> = {};
  for (const [id, promise] of Object.entries(channelPromises)) {
    const channel = await promise;
    if (channel) {
      channels[id] = channel;
    }
  }

  const teams: Record<string, TeamInfoResponse["team"]> = {};
  for (const [id, promise] of Object.entries(teamPromises)) {
    const team = await promise;
    if (team) {
      teams[id] = team;
    }
  }

  const users: Record<string, UsersInfoResponse["user"]> = {};
  for (const [id, promise] of Object.entries(userPromises)) {
    const user = await promise;
    if (user) {
      users[id] = user;
    }
  }

  // Second pass: construct metadata for each message
  const result: ExtractMessagesMetadataResult<T> = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    const mentions: MessageMetadata["mentions"] = [];
    const files: MessageMetadata["files"] = [];

    // Extract mentions
    if (message.blocks && Array.isArray(message.blocks)) {
      const messageMentions = extractMentionsFromMessageBlocks(
        message.blocks as AnyBlock[]
      );
      const seenIds = new Set<string>();

      for (const mention of messageMentions) {
        switch (mention.type) {
          case "channel": {
            if (seenIds.has(mention.channel_id)) continue;
            seenIds.add(mention.channel_id);
            const channel = channels[mention.channel_id];
            if (channel) {
              mentions.push({
                type: "channel",
                id: mention.channel_id,
                channel,
              });
            }
            break;
          }
          case "team": {
            if (seenIds.has(mention.team_id)) continue;
            seenIds.add(mention.team_id);
            const team = teams[mention.team_id];
            if (team) {
              mentions.push({
                type: "team",
                id: mention.team_id,
                team,
              });
            }
            break;
          }
          case "user": {
            if (seenIds.has(mention.user_id)) continue;
            seenIds.add(mention.user_id);
            const user = users[mention.user_id];
            if (user) {
              mentions.push({
                type: "user",
                id: mention.user_id,
                user,
              });
            }
            break;
          }
        }
      }
    }

    // Extract files
    const messageFiles = message.files as GenericMessageEvent["files"];
    const messageFileResults = fileResults.get(i);
    if (messageFiles && messageFileResults) {
      for (const file of messageFiles) {
        const fileResult = messageFileResults.get(file.id);
        if (fileResult) {
          files.push(fileResult);
        }
      }
    }

    // Get user info
    const user = message.user ? users[message.user] : undefined;

    // Get channel info
    const channel = message.channel ? channels[message.channel] : undefined;

    // Parse timestamp
    let createdAt: Date;
    try {
      const ts = message.ts;
      if (ts) {
        createdAt = new Date(parseFloat(ts) * 1000);
      } else {
        createdAt = new Date();
      }
    } catch {
      createdAt = new Date();
    }

    result.push({
      message,
      metadata: {
        mentions,
        files,
        user,
        createdAt,
        channel,
      },
    });
  }

  return result;
};

/**
 * extractMentionsFromMessageBlocks extracts mentions from a message blocks.
 * @param blocks - The message blocks.
 * @returns The mentions.
 */
export const extractMentionsFromMessageBlocks = (
  blocks: AnyBlock[]
): Array<
  | RichTextChannelMention
  | RichTextTeamMention
  | RichTextUserMention
  | RichTextUsergroupMention
> => {
  const mentions: Array<
    | RichTextChannelMention
    | RichTextTeamMention
    | RichTextUserMention
    | RichTextUsergroupMention
  > = [];
  for (const block of blocks) {
    if (block.type !== "rich_text") {
      continue;
    }
    if (!("elements" in block)) {
      continue;
    }
    for (const element of block.elements) {
      if (element.type !== "rich_text_section") {
        continue;
      }
      for (const subelement of element.elements) {
        if (
          subelement.type !== "user" &&
          subelement.type !== "channel" &&
          subelement.type !== "team" &&
          subelement.type !== "usergroup"
        ) {
          continue;
        }
        mentions.push(subelement);
      }
    }
  }
  return mentions;
};

export const defaultSupportedFileTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/pdf",
];
