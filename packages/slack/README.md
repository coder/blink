# @blink-sdk/slack

The easiest way to build Slack bots with the AI SDK.

```ts
import * as blink from "blink";
import * as slack from "@blink-sdk/slack";
import { App } from "@slack/bolt";
import { convertToModelMessages, streamText } from "ai";

// Use your respective Agent class.
const agent = new blink.Agent();

const receiver = new slack.Receiver();
const app = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  receiver,
})

// Add listeners to start chats.
app.event("app_mention", async ({ event }) => {
  const chat = await agent.chat.upsert([
    "slack",
    event.team,
    event.channel,
    event.thread_ts ?? event.ts,
  ]);
  const message = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  })
})

agent.on("request", async (request) => {
  return receiver.handle(app, request);
});

agent.on("chat", async ({ messages }) => {
  // Provide Slack tools with the same client.
  // Use message metadata to enable multi-modeality with your agent.
  const tools = slack.createTools({ client: app.client });

  return streamText({
    model: blink.model("anthropic/claude-sonnet-4.5"),
    system: `You are kyletestbot, a helpful Slack assistant.

You can help users with questions, provide information, and assist with tasks.
You have access to web search to find current information on the internet.
Be friendly, concise, and helpful.`,
    messages: convertToModelMessages(messages, {
      tools,
      ignoreIncompleteToolCalls: true,
    }),
    tools,,
  });
});

agent.serve()
```
