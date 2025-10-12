import type { LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";
import { WebClient, type AnyBlock, type Button } from "@slack/web-api";
import type { MessageElement } from "@slack/web-api/dist/types/response/ConversationsHistoryResponse";
import { tool } from "ai";
import { z } from "zod";
import {
  extractMessagesMetadata,
  formatMessage,
  formattingRules,
  type ExtractMessagesMetadataOptions,
  type MessageMetadata,
} from "./message";

export interface CreateToolsOptions
  extends Pick<
    ExtractMessagesMetadataOptions<any>,
    "supportedFileTypes" | "maxFileSize"
  > {
  readonly client: WebClient;

  /**
   * disableViewingUserProfilePictures is a boolean that, when true, will not allow
   * the getUser tool to return the user's profile picture.
   */
  readonly disableViewingUserProfilePictures?: boolean;

  /**
   * disableMessagingInChannels is a boolean that, when true, will not allow
   * the sendMessage tool to send messages directly to channels. A thread must
   * be specified.
   */
  readonly disableMessagingInChannels?: boolean;
}

/**
 * createTools creates a set of Slack tools for use with the AI SDK.
 *
 * @param options - The options for the tools.
 * @returns The tools for the bot user in Slack.
 */
export const createTools = ({
  client,
  supportedFileTypes,
  maxFileSize,
  disableViewingUserProfilePictures,
  disableMessagingInChannels,
}: CreateToolsOptions) => {
  const sendMessageDescription =
    "The timestamp of the message to send in response to.";
  let sendMessageTs = z
    .string()
    .describe(sendMessageDescription) as unknown as z.ZodOptional<z.ZodString>;
  if (!disableMessagingInChannels) {
    sendMessageTs = sendMessageTs
      .describe(`${sendMessageDescription} Omit to send to the channel.`)
      .optional() as unknown as z.ZodOptional<z.ZodString>;
  }

  return {
    /**
     * sendMessage is a tool that sends a message to Slack.
     */
    sendMessage: tool({
      description: `Send a message to Slack.`,
      inputSchema: z.object({
        message: z.string().describe(
          `The message to send to Slack.

${formattingRules}`
        ),
        actions: z.array(
          z
            .object({
              type: z.enum(["button"]),
              text: z.object({
                type: z.literal("plain_text"),
                text: z.string(),
              }),
              url: z.string(),
            })
            .describe(
              "Specify external links to show in a message. Common examples are links to pull requests, issues, or other labeled URLs."
            )
        ),
        text_snippets: z
          .array(
            z.object({
              name: z.string(),
              content: z.string(),
              type: z
                .string()
                .describe(
                  "The type of snippet. Any programming language, or 'text' if it's not a code snippet."
                ),
            })
          )
          .describe(
            "Text snippets to send immediately after the message. Use this for long-form atomized responses, like code snippets, blog posts, tutorials, etc. Reference these snippets in your text response."
          ),
        image_urls: z
          .array(
            z.object({
              url: z.string(),
              alt_text: z.string(),
            })
          )
          .describe("A list of images to show in the message."),
        channel: z.string().describe("The channel to send the message to."),
        ts: sendMessageTs,
      }),
      execute: async (args, options) => {
        if (disableMessagingInChannels && !args.ts) {
          throw new Error("ts is required! Messaging in channels is disabled.");
        }

        const text = formatMessage(args.message);
        const blocks: AnyBlock[] = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              // Ocassionally, the LLM will send a message with \n instead of newlines.
              text: text.replaceAll("\\n", "\n").replaceAll('\\"', '"'),
            },
          },
        ];

        for (const image_url of args.image_urls) {
          blocks.push({
            type: "image",
            image_url: image_url.url,
            alt_text: image_url.alt_text,
          });
        }

        const actions: Button[] = [];
        args.actions.forEach((action) => {
          actions.push({
            type: "button",
            text: action.text,
            url: action.url,
          });
        });

        if (actions.length > 0) {
          blocks.push({
            type: "actions",
            elements: actions,
          });
        }

        const res = await client.chat.postMessage({
          channel: args.channel,
          thread_ts: args.ts,
          text: args.message,
          blocks,
        });
        if (!res.ok) {
          throw new Error(`Failed to send message: ${res.error}`);
        }
        return {
          success: true,
        };
      },
    }),

    reactToMessage: tool({
      description: `React to a message in Slack.

Prefer reacting to the most recent messages in a thread.`,
      inputSchema: z.object({
        channel: z.string().describe("The channel to react to the message in."),
        ts: z.string().describe("The timestamp of the message to react to."),
        reaction: z.string().describe(`The Slack reaction to add to the message.

Reactions:
- :thumbsup:
- :thumbsdown:
- :laughing:
- :heart:
- :eyes:
- :confused:
- :thinking_face:
- :sob:
- :scream:
- :thinking_face:

This is not an exhaustive list. You can try to add emojis you remember from Slack.

IMPORTANT: This MUST be text, not an emoji.`),
        remove_reaction: z
          .boolean()
          .describe(
            `Set to true if you want to remove a reaction from a message.`
          ),
      }),
      execute: async (args) => {
        let reaction = args.reaction;
        if (reaction.startsWith(":") && reaction.endsWith(":")) {
          // Sometimes the LLMs put colons around the Slack emojis.
          reaction = reaction.slice(1, -1);
        }
        if (args.remove_reaction) {
          const res = await client.reactions.remove({
            channel: args.channel,
            timestamp: args.ts,
            name: reaction,
          });
          if (!res.ok) {
            throw new Error(`Failed to react to message: ${res.error}`);
          }
        } else {
          const res = await client.reactions.add({
            channel: args.channel,
            timestamp: args.ts,
            name: reaction,
          });
          if (!res.ok) {
            throw new Error(`Failed to react to message: ${res.error}`);
          }
        }
        return {
          success: true,
        };
      },
    }),

    readMessages: tool({
      description: `Read messages from channels by ID. Messages with "thread_ts" have replies that can be read. Attachments are not included as results. Read individual messages to get attachments.`,
      inputSchema: z.object({
        channel: z.string().describe("The channel to read messages from."),
        limit: z.number().describe("The number of messages to read."),
        cursor: z
          .string()
          .describe("The cursor to use to paginate through the messages."),
      }),
      execute: async (args) => {
        const messages = await client.conversations.history({
          channel: args.channel,
          limit: args.limit,
          cursor: args.cursor,
        });
        if (!messages.ok) {
          throw new Error(`Failed to read messages: ${messages.error}`);
        }
        const metadata = await extractMessagesMetadata({
          client,
          messages: messages.messages ?? [],
          // This prevents files from being downloaded.
          supportedFileTypes: [],
        });
        return metadata.map((message) =>
          convertMetadataToPartialMessage(message.message, message.metadata)
        );
      },
    }),

    readMessage: tool({
      description:
        "Read a message from a channel by ID. This reads attachments as well.",
      inputSchema: z.object({
        channel: z.string().describe("The channel to read the message from."),
        ts: z.string().describe("The timestamp of the message to read."),
      }),
      execute: async (args) => {
        const messages = await client.conversations.history({
          channel: args.channel,
          latest: args.ts,
          inclusive: true,
          limit: 1,
        });
        if (!messages.ok) {
          throw new Error(`Failed to read message: ${messages.error}`);
        }
        const message = messages.messages?.[0];
        if (!message) {
          throw new Error("Message not found");
        }
        const metadata = await extractMessagesMetadata({
          client,
          messages: [message],
          supportedFileTypes,
          maxFileSize,
        });
        const msg = metadata[0];
        if (!msg) {
          throw new Error("Message not found");
        }
        return {
          message: convertMetadataToPartialMessage(msg.message, msg.metadata),
          files: msg.metadata.files.map((file) => ({
            name: file.file.name,
            mimetype: file.file.mimetype,
            result:
              file.result.type === "downloaded"
                ? {
                    type: "downloaded",
                    base64: file.result.content.toString("base64"),
                  }
                : file.result,
          })),
        };
      },
      toModelOutput(output) {
        const { message, files } = output;
        const parts: Extract<
          LanguageModelV2ToolResultOutput,
          { type: "content" }
        >["value"] = [];
        for (const file of files) {
          if (file.result.type === "downloaded") {
            parts.push({
              type: "media",
              data: file.result.base64,
              mediaType: file.mimetype,
            });
          } else {
            parts.push({
              type: "text",
              text: `The user attached file ${file.name}, but it was not downloaded: ${JSON.stringify(file.result)}`,
            });
          }
        }
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: JSON.stringify(message),
            },
            ...parts,
          ],
        };
      },
    }),

    readThreadReplies: tool({
      description: "Read the replies to a message in a thread.",
      inputSchema: z.object({
        channel: z
          .string()
          .describe("The channel to read the thread replies from."),
        ts: z
          .string()
          .describe(
            "The timestamp of the message to read the thread replies from."
          ),
        cursor: z
          .string()
          .describe("The cursor to use to paginate through the replies."),
        limit: z.number().describe("The number of replies to read."),
      }),
      execute: async (args) => {
        const messages = await client.conversations.replies({
          channel: args.channel,
          ts: args.ts,
          cursor: args.cursor,
          limit: args.limit,
        });
        if (!messages.ok) {
          throw new Error(`Failed to read thread replies: ${messages.error}`);
        }
        const metadata = await extractMessagesMetadata({
          client,
          messages: messages.messages ?? [],
          supportedFileTypes,
          maxFileSize,
        });
        return metadata.map((message) =>
          convertMetadataToPartialMessage(message.message, message.metadata)
        );
      },
    }),

    getUserInfo: tool({
      description: `Get information about a Slack user by ID.${!disableViewingUserProfilePictures ? " The profile picture of the user will be returned if available." : ""}`,
      inputSchema: z.object({
        user_id: z
          .string()
          .describe("The ID of the user to get information about."),
      }),
      execute: async (args) => {
        const user = await client.users.info({
          user: args.user_id,
        });
        if (!user.ok || !user.user) {
          throw new Error(`Failed to get user info: ${user.error}`);
        }

        const profilePictureURL =
          user.user?.profile?.image_512 ?? user.user?.profile?.image_192;
        let image:
          | {
              data: string;
              mediaType: string;
            }
          | undefined;
        if (!disableViewingUserProfilePictures && profilePictureURL) {
          try {
            const result = await fetch(profilePictureURL);
            if (
              result.ok &&
              result.headers.get("content-type")?.startsWith("image/")
            ) {
              image = {
                data: Buffer.from(await result.arrayBuffer()).toString(
                  "base64"
                ),
                mediaType: result.headers.get("content-type") ?? "",
              };
            }
          } catch (error) {
            // noop - it's not very important to fetch the image.
          }
        }

        return {
          user: user.user,
          image,
        };
      },
      toModelOutput(output) {
        const { user, image } = output;
        if (disableViewingUserProfilePictures || !image) {
          return {
            type: "json",
            value: JSON.stringify(user),
          };
        }
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: JSON.stringify(user),
            },
            {
              type: "media",
              data: image.data,
              mediaType: image.mediaType,
            },
          ],
        };
      },
    }),

    reportStatus: tool({
      description: `Report your status to Slack. You *MUST* do this BEFORE executing tools or thinking, it DRAMATICALLY IMPROVES THE USER EXPERIENCE by helping them understand what you\'re working on. Run this in parallel as you execute other tools, expressing your intent. Do this after running tools, before sending messages as well. e.g. "is responding to XXX inquiry...". It will appear as: "<your name> <message>". So prefix with "is" and suffix with an ellipsis.
        
Clear the status by passing an empty string.`,
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "A short present-participle verb + brief user-facing update. NEVER use underscores or non-natural language words. Keep it short - under 100 characters."
          ),
        channel: z.string().describe("The channel to report your status to."),
        thread_ts: z
          .string()
          .describe("The timestamp of the thread to report your status to."),
      }),
      execute: async (args) => {
        const res = await client.assistant.threads.setStatus({
          channel_id: args.channel,
          thread_ts: args.thread_ts,
          status: args.message,
        });
        if (!res.ok) {
          throw new Error(`Failed to report status: ${res.error}`);
        }
        return {
          success: true,
        };
      },
    }),
  };
};

type PartialMessage = {
  thread_ts?: string;
  ts?: string;
  ts_formatted?: string;
  text?: string;

  mentions: Array<
    | {
        type: "channel";
        id: string;
        name?: string;
      }
    | {
        type: "team";
        id: string;
        name?: string;
      }
    | {
        type: "user";
        id: string;
        name?: string;
        real_name?: string;
        display_name?: string;
      }
  >;

  files: Array<{
    name: string | null;
    mimetype: string;
    size: number;
  }>;
};

const convertMetadataToPartialMessage = (
  message: MessageElement,
  metadata: MessageMetadata
): PartialMessage => {
  return {
    thread_ts: message.thread_ts,
    ts: message.ts,
    ts_formatted: metadata.createdAt.toLocaleString(),
    text: message.text,
    files: metadata.files.map((file) => ({
      name: file.file.name,
      mimetype: file.file.mimetype,
      size: file.file.size,
    })),
    mentions: metadata.mentions.map((mention) => {
      switch (mention.type) {
        case "channel":
          return {
            type: "channel",
            id: mention.id,
            name: mention.channel.name,
          };
        case "team":
          return {
            type: "team",
            id: mention.id,
            name: mention.team.name,
          };
        case "user":
          return {
            type: "user",
            id: mention.id,
            name: mention.user.name,
            real_name: mention.user.real_name,
            display_name: mention.user.profile?.display_name,
          };
      }
    }),
  };
};
