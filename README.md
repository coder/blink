<a href="https://blink.coder.com#gh-dark-mode-only">
<img src="./scripts/logo-white.svg" style="height: 40px;">
</a>
<a href="https://blink.coder.com#gh-light-mode-only">
<img src="./scripts/logo-black.svg" style="height: 40px;">
</a>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![discord](https://img.shields.io/discord/747933592273027093?label=discord)](https://discord.gg/coder)
![NPM Version](https://img.shields.io/npm/v/blink)

Blink is a way to build and deploy chat agents with the AI SDK.

```ts
import { Agent } from "blink";
import { sendMessages } from "ai";

const agent = new Agent();

agent.on("chat", ({ messages }) => {
  return sendMessages({
    model: "anthropic/claude-sonnet-4.5",
    messages: convertToModelMessages(messages),
  });
});

agent.serve();
```

To chat with the agent, run `blink dev` to enter a terminal interface.

- Leverages the familiar [AI SDK](https://github.com/vercel/ai) at it's core.
- SDKs for making Slack and GitHub bots.
- Run your agent locally without ever deploying to the cloud.

## Get Started

Install Blink:

```sh
npm i -g blink
```

Create your first agent:

```sh
# creates the agent source code in your current directory
blink init

# starts a hot-reloading terminal interface to chat with your agent
blink dev
```

Create a Slack bot in under a minute:

https://github.com/user-attachments/assets/6bb73e58-b4ae-4543-b2c0-0e1195113ba6

> [!NOTE]
> You provide LLM API keys. `blink init` guides you through this, or add them to `.env.local` later.

## Deploy

If you wish to deploy your agent to the [cloud](https://blink.coder.com), run:

```sh
blink deploy
```

> [!IMPORTANT]
> [Cloud](https://blink.coder.com) is not required to build Blink agents.
> We guarantee that Blink agents will always be local-first.

## User Guide

### Developing an Agent

Blink has two modes: run and edit (toggle with `ctrl+t`, or `/run` and `/edit`). Run mode is blue, edit mode is orange. Run mode allows you to chat with your agent. Edit mode allows you to take context from run mode, and edit the agent.

Chat in run mode, switch to edit mode and provide feedback, then go back to run mode and continue chatting. Agents hot-reload as you develop, so changes are reflected instantly.

> [!NOTE]
> Run mode cannot see edit mode messages.

https://github.com/user-attachments/assets/4abd47ad-4b59-41d5-abda-27ed902ae69b

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

Locally, all chats are stored in `./.blink/chats/<key>.json` relative to where your agent is running.

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
    model: "anthropic/claude-sonnet-4",
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

Locally, all storage is in `./.blink/storage.json` relative to where your agent is running.

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
    model: "anthropic/claude-sonnet-4",
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
    model: "anthropic/claude-sonnet-4",
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
    model: "anthropic/claude-sonnet-4",
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

For a closer look at Blink, visit [docs.blink.coder.com](https://docs.blink.coder.com/).
