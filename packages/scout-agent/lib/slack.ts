import * as slack from "@blink-sdk/slack";
import type { KnownEventFromType } from "@slack/bolt";
import { App } from "@slack/bolt";
import type { Tool, UIMessage } from "ai";
import * as blink from "blink";
import type { Message } from "./types";

export const createSlackApp = ({
  agent,
  slackSigningSecret,
  slackBotToken,
}: {
  agent: blink.Agent<UIMessage>;
  slackSigningSecret: string;
  slackBotToken: string;
}): { app: App; receiver: slack.Receiver } => {
  const receiver = new slack.Receiver({
    signingSecret: slackSigningSecret,
  });
  const app = new App({
    token: slackBotToken,
    signingSecret: slackSigningSecret,
    receiver,
  });

  app.event("app_mention", async ({ event }) => {
    blink.waitUntil(handleSlackEvent({ event, slackApp: app, agent }));
  });

  app.event("message", async ({ event }) => {
    // Ignore message changes. These are emitted when the agent responds in DMs, since
    // it it seems that the agent first sends a blank message and then updates it with the actual response.
    if (event.subtype === "message_changed") {
      return;
    }
    if (event.subtype === "bot_message") {
      return;
    }
    // Only handle DMs (channel_type will be 'im' for direct messages)
    if ("channel_type" in event && event.channel_type === "im") {
      blink.waitUntil(
        handleSlackEvent({
          event,
          slackApp: app,
          agent,
        })
      );
    }
  });

  return { app, receiver };
};

const handleSlackEvent = async ({
  event,
  slackApp: app,
  agent,
}: {
  event: KnownEventFromType<"app_mention"> | KnownEventFromType<"message">;
  slackApp: App;
  agent: blink.Agent<UIMessage>;
}) => {
  const threadTs =
    "thread_ts" in event && event.thread_ts ? event.thread_ts : event.ts;
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: threadTs,
  });
  try {
    const chat = await agent.chat.upsert(["slack", event.channel, threadTs]);
    const { message, metadata } = await slack.createMessageFromEvent({
      client: app.client,
      event,
    });
    await agent.chat.sendMessages(chat.id, [
      {
        ...message,
        role: "user",
        metadata: {
          shared_channel: metadata.channel?.is_shared ?? false,
          ext_shared_channel: metadata.channel?.is_ext_shared ?? false,
          type: "slack",
          channel_name: metadata.channel?.name ?? "",
        },
      },
    ]);
  } catch (error) {
    await app.client.assistant.threads.setStatus({
      channel_id: event.channel,
      status: `failed to chat: ${String(error)}`,
      thread_ts: threadTs,
    });
  }
};

export const createSlackTools = ({
  slackApp,
}: {
  slackApp: App;
}): Record<string, Tool> => {
  return blink.tools.prefix(
    slack.createTools({ client: slackApp.client }),
    "slack_"
  );
};

export const getSlackMetadata = (messages: Message[]) => {
  return messages.find((m) => m.metadata?.type === "slack")?.metadata as
    | Extract<Message["metadata"], { type: "slack" }>
    | undefined;
};
