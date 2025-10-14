import { convertToModelMessages, streamText } from "ai";
import * as blink from "blink";
import * as slack from "@blink-sdk/slack";
import { App } from "@slack/bolt";

const receiver = new slack.Receiver();
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver,
});

// Triggered when the bot is @mentioned
app.event("app_mention", async ({ event }) => {
  const chat = await agent.chat.upsert([
    "slack",
    event.channel,
    event.thread_ts ?? event.ts,
  ]);
  const { message } = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  });
});

const agent = new blink.Agent();

agent.on("request", async (request) => {
  return receiver.handle(app, request);
});

agent.on("chat", async ({ messages }) => {
  const tools = slack.createTools({ client: app.client });
  const lastMessage = messages[messages.length - 1];
  const threadInfo = lastMessage?.metadata as
    | { channel?: string; thread_ts?: string }
    | undefined;

  // Add instruction to clear status after completion
  if (threadInfo?.channel && threadInfo?.thread_ts) {
    const clonedMessages = structuredClone(messages);
    const lastClonedMessage = clonedMessages[clonedMessages.length - 1];
    if (lastClonedMessage) {
      lastClonedMessage.parts.push({
        type: "text",
        text: `*INTERNAL INSTRUCTION*: Clear the status of this thread after you finish: channel=${threadInfo.channel} thread_ts=${threadInfo.thread_ts}`,
      });
    }
    messages = clonedMessages;
  }

  return streamText({
    model: blink.model("anthropic/claude-sonnet-4.5"),
    system: "You are a helpful Slack bot assistant.",
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    tools,
  });
});

agent.serve();
