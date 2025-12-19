import { streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { type Message, Scout } from "./lib";

export const agent = new blink.Agent<Message>();

const ensure = (value: string | undefined): string => {
  if (value === undefined) {
    throw new Error("value is undefined");
  }
  return value;
};

const scout = new Scout({
  agent,
  github: {
    appID: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  },
  webSearch: {
    exaApiKey: process.env.EXA_API_KEY,
  },
  compute: {
    type: "coder",
    options: {
      url: ensure(process.env.CODER_URL),
      sessionToken: ensure(process.env.CODER_SESSION_TOKEN),
      template: ensure(process.env.CODER_TEMPLATE),
      presetName: ensure(process.env.CODER_PRESET_NAME),
    },
  },
});

agent.on("request", async (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/slack")) {
    return scout.handleSlackWebhook(request);
  }
  if (url.pathname.startsWith("/github")) {
    return scout.handleGitHubWebhook(request);
  }
  return new Response("Hey there!", { status: 200 });
});

agent.on("chat", async ({ id, messages }) => {
  const params = await scout.buildStreamTextParams({
    messages,
    chatID: id,
    model: "anthropic/claude-opus-4.5",
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    tools: {
      get_favorite_color: tool({
        description: "Get your favorite color",
        inputSchema: z.object({}),
        execute() {
          return "blue";
        },
      }),
    },
  });
  return streamText(params);
});

agent.serve();
