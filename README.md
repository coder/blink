<a href="https://blink.so#gh-dark-mode-only">
<img src="./scripts/logo-white.svg" style="height: 50px;">
</a>
<a href="https://blink.so#gh-light-mode-only">
<img src="./scripts/logo-black.svg" style="height: 50px;">
</a>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![discord](https://img.shields.io/discord/747933592273027093?label=discord)](https://discord.gg/coder)
![NPM Version](https://img.shields.io/npm/v/blink)

## Blink Overview

Blink is an MIT-licensed agent development engine that provides a complete foundation for building, deploying, and scaling AI agents as code. We believe language models are the core of the experience, and Blink gives you the freedom to use them to their full potential.

Bring your own LLM keys to build and run Blink agents locally. Deployment to Blink Cloud will never be required. You can develop, test, and run agents entirely on your own machine without even creating a Blink Cloud account.

- **Blink agents are Node.js servers** written in TypeScript that handle chat messages, webhooks, and API requests over HTTP.
- **Blink comes with comprehensive SDKs** that give you the ability to deploy agents to Slack and GitHub with ease
- **The platform handles all the infrastructure** complexity with serverless deployment, logging, and scaling, so you can focus on building
- **Full portability between local development and production** with identical behavior across environments
- **Use the popular Vercel AI SDK** with support for multiple LLM providers and streaming responses

## Getting Started

Creating your first agent or Slackbot is quick with the Blink CLI. You can build, test, and start chatting with your agent in Slack in just a few minutes, right from your terminal.

https://github.com/user-attachments/assets/6bb73e58-b4ae-4543-b2c0-0e1195113ba6

### Use your favorite package manager to globally install `blink`:

```sh
bun i -g blink
```
```sh
npm i -g blink
```
```sh
pnpm add -g blink
```
```sh
yarn global add blink
```

### Create an agent:

```sh
mkdir my-agent
cd my-agent
blink init
```

> [!NOTE]
> You'll need to provide your own LLM API keys. Add them during `blink init` or add them later to `.env.local` and the dev server will automatically load them.

### Start development mode:

```sh
blink dev
```

You can now edit `agent.ts` in your editor or by using [Edit Mode](https://docs.blink.so/get-started/building-with-blink) in your terminal and the dev server will hot-reload your agent.

### Deploy your agent to [Blink Cloud](https://blink.so):

```sh
blink deploy
```
> [!IMPORTANT]
> [Blink Cloud](https://blink.so) is not required to build Blink agents.
> We guarantee that Blink agents will always be local-first.

## Building with Edit and Run Modes

After running `bun i -g blink` to globally install Blink, run `blink init` to scaffold your new agent.

https://github.com/user-attachments/assets/683e4554-55fd-4240-916d-a496da7e63d2

Giving your new agents tools and personality is as easy as switching to [Edit Mode](https://docs.blink.so/get-started/building-with-blink) `(CTRL+T)` and describing what you want your agent to do.

Edit Mode is specifically trained to build your agent and understand the full context of both Edit Mode and Run Mode chats. This is a key capability that makes Edit Mode the essential building and debugging partner.

> [!NOTE]
> Run Mode can only read its own context to preserve a real-world user experience while testing in your terminal.

https://github.com/user-attachments/assets/4abd47ad-4b59-41d5-abda-27ed902ae69b


## How Blink Agents Work

Building agents in Run Mode lifts most of the burden of coding new agents. However, here's a breakdown of how Blink agents work under the hood.

Blink has built-in APIs for managing chats, storage, and tools.

### Chats

Blink allows you to start new chats from web requests:

```ts
import blink from "blink";

const agent = blink.agent();

agent.on("request", async (request, context) => {
  // Check if this is a request you'd like to start a chat for.
  // e.g. if this is a webhook from Slack, start a chat for that thread.

  // Specify a unique key for the chat so that on subsequent requests, the same chat is used.
  const chat = await blink.chat.upsert(`slack-${request.body.thread_ts}`);

  await blink.chat.message(
    chat.id,
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: "Hello, how can I help you today?",
        },
      ],
    },
    {
      // Blink manages chat state for you. Interrupt, enqueue, or append messages.
      behavior: "interrupt",
    }
  );

  // This would trigger the chat event handler in your agent.
});

// ... agent.on("chat", ...) ...

agent.serve();
```

Locally, all chats are stored in `./data/chats/<key>.json` relative to where your agent is running.

In the cloud, chats keys are namespaced per-agent.

### Storage

Blink has a persistent key-value store for your agent:

```ts
import { convertToModelMessages, streamText, tool } from "ai";
import blink from "blink";
import { z } from "zod";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4"),
    system: "You are a helpful assistant.",
    messages: convertToModelMessages(messages),

    tools: {
      set_memory: tool({
        description: "Set a value to remember later.",
        inputSchema: z.object({
          key: z.string(),
          value: z.string(),
        }),
        execute: async ({ key, value }) => {
          await blink.storage.set(key, value);
          return "Saved memory!";
        },
      }),
      get_memory: tool({
        description: "Get a value from your memory.",
        inputSchema: z.object({
          key: z.string(),
        }),
        execute: async ({ key }) => {
          const value = await blink.storage.get(key);
          return `The value for ${key} is ${value}`;
        },
      }),
      delete_memory: tool({
        description: "Delete a value from your memory.",
        inputSchema: z.object({
          key: z.string(),
        }),
        execute: async ({ key }) => {
          await blink.storage.delete(key);
          return `Deleted memory for ${key}`;
        },
      }),
    },
  });
});

agent.serve();
```

Locally, all storage is in `./data/storage.json` relative to where your agent is running.

In the cloud, storage is namespaced per-agent.

### Tools

Blink has helpers for [tool approvals](#manual-approval), and [commonly used tools](#toolsets).

#### Manual Approval

Some tools you'd prefer to approve manually, particularly if they're destructive.

```ts
import { convertToModelMessages, streamText, tool } from "ai";
import blink from "blink";
import { z } from "zod";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4"),
    system: "You are a helpful assistant.",
    messages: convertToModelMessages(messages),

    tools: {
      harmless_tool: tool({
        description: "A harmless tool.",
        inputSchema: z.object({
          name: z.string(),
        }),
        execute: async ({ name }) => {
          return `Hello, ${name}!`;
        },
      }),
      ...blink.tools.withApproval({
        messages,
        tools: {
          destructive_tool: tool({
            description: "A destructive tool.",
            inputSchema: z.object({
              name: z.string(),
            }),
            execute: async ({ name }) => {
              return `Destructive tool executed!`;
            },
          }),
        },
      }),
    },
  });
});

agent.serve();
```

Blink will require explicit approval by the user before `destructive_tool` is executed - displaying a UI to the user to approve or reject the tool call.

#### Toolsets

Blink has SDK packages for common tools, like Slack, GitHub, and Search:

```ts
import github from "@blink-sdk/github";
import { convertToModelMessages, streamText } from "ai";
import blink from "blink";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4"),
    system: "You are a helpful assistant.",
    messages: convertToModelMessages(messages),

    tools: {
      ...github.tools,
    },
  });
});

agent.serve();
```

By default, GitHub tools will not have authentication. Provide context to tools:

```ts
import blink from "blink";

blink.tools.withContext(github.tools, {
  accessToken: process.env.GITHUB_TOKEN,
  // optionally, specify app auth, or your own Octokit instance
});
```

#### Customizing Tools

You can override any descriptions to customize behavior:

```ts
import github from "@blink-sdk/github";
import { convertToModelMessages, streamText } from "ai";
import blink from "blink";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4"),
    system: "You are a helpful assistant.",
    messages: convertToModelMessages(messages),

    tools: {
      ...github.tools,
      // Override the default tool with your own description.
      create_issue: {
        ...github.tools.create_issue,
        description: "Create a GitHub issue. *Never* tag users.",
      },
    },
  });
});

agent.serve();
```

### Custom Models

You do not need to use the AI SDK with Blink. Return a `Response` in `sendMessages` using `withResponseFormat`:

```ts
import * as blink from "blink";
import OpenAI from "openai";

const client = new OpenAI();
const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  const stream = await client.chat.completions
    .create({
      model: "gpt-4o",
      messages: messages.map((m) => ({
        role: m.role,
        content: m.parts
          .map((p) => {
            if (p.type === "text") {
              return p.text;
            }
          })
          .join("\n"),
      })),
      stream: true,
    })
    .withResponse();
  return blink.withResponseFormat(stream.response, "openai-chat");
});

agent.serve();
```

### Custom Bundling

Create a `blink.config.ts` file in your project root (next to `package.json`):

```ts
import { defineConfig, buildWithEsbuild } from "blink/build";

export default defineConfig({
  entry: "src/agent.ts",
  outdir: "dist",
  build: buildWithEsbuild({
    // ... esbuild options ...
  }),
});
```

By default, Blink uses [esbuild](https://esbuild.github.io/) to bundle your agent.

The `build` function can be customized to use a different bundler if you wish.


## Blink Documentation

For a closer look at Blink, visit [docs.blink.so](https://docs.blink.so/).
