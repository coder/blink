<a href="https://blink.so#gh-dark-mode-only">
<img src="./scripts/logo-white.svg" style="height: 50px;">
</a>
<a href="https://blink.so#gh-light-mode-only">
<img src="./scripts/logo-black.svg" style="height: 50px;">
</a>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![discord](https://img.shields.io/discord/747933592273027093?label=discord)](https://discord.gg/coder)
![NPM Version](https://img.shields.io/npm/v/blink)

Blink is a tool for building and sharing AI agents.

- Leverages the familiar [AI SDK](https://github.com/vercel/ai) at it's core.
- Built-in tools for making Slack, GitHub, and Discord bots.
- Every agent is simply a Node HTTP server - no cloud required.

## Getting Started

Install the `blink` package with your favorite package manager:

```sh
bun i -g blink
```

Create an agent:

```sh
mkdir my-agent
cd my-agent
blink init
```

Start development mode:

> [!NOTE]
> You'll need to provide your own API keys to use language models. Put them in `.env.local` and the dev server will automatically load them.

```sh
blink dev
```

You can now edit `src/agent.ts` and the dev server will hot-reload your agent.

Bundle your agent as a Node package to share it with others:

```sh
blink build
npm publish
```

Optionally, deploy your agent to [blink.so](https://blink.so):

> [!NOTE]
> [blink.so](https://blink.so) is not required to use Blink.
> We [guarantee](#why-blink) that Blink agents will always be local-first.

```sh
blink deploy
```

## Building Your First Agent

Here are some examples of agents commonly built with Blink:

- [Coding Agent](./examples/coding-agent) with tools and context specific to your codebase.
- [Customer Support Agent](./examples/customer-support-agent) directed to understand your product and documentation.
- [Slack Bot](./examples/slack-bot) with information relevant to your company.
- [GitHub Bot](./examples/github-bot) with custom tools to interact with your repositories.
- [Everything Agent](./examples/everything-agent) that does all of the above to show the full power of Blink.

## Developing an Agent

Blink has built-in APIs for managing [chats](#chats), [storage](#storage), and [tools](#tools).

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

## Why Blink?

Blink is a tool for building AI agents, not a framework. It's simple at it's core. Every agent is an HTTP server that follows a [basic protocol](#).

You provide the tools, and Blink handles the rest. We believe that the language models are the most important part of the equation, and we allow you to leverage the full power of them.

Blink will never require the cloud to run agents. Blink is MIT licensed - you don't have to trust us.

## Cloud

`blink deploy` runs your agent in the cloud at [blink.so](https://blink.so).

This allows you to share your agent with others, and to access it from anywhere.
