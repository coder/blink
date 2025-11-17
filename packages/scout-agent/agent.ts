import { tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { GeneralPurposeCore, type Message, type Options } from "./lib";

export const agent = new blink.Agent<blink.WithUIOptions<Options, Message>>();

const core = new GeneralPurposeCore({
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
    type: "docker",
  },
});

agent.on("request", async (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/slack")) {
    return core.handleSlackWebhook(request);
  }
  if (url.pathname.startsWith("/github")) {
    return core.handleGitHubWebhook(request);
  }
  return new Response("Hey there!", { status: 200 });
});

agent.on("chat", async ({ id, messages }) => {
  return core.streamStepResponse({
    chatID: id,
    messages,
    model: "anthropic/claude-sonnet-4.5",
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    tools: {
      get_favorite_color: tool({
        description: "Get your favorite color",
        inputSchema: z.object({}),
        async *execute() {
          yield "blue";
          await new Promise((resolve) => setTimeout(resolve, 1000));
          yield "red";
          await new Promise((resolve) => setTimeout(resolve, 1000));
          yield "green";
        },
      }),
    },
  });
});

agent.serve();
