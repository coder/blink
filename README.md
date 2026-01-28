<a href="https://blink.coder.com#gh-dark-mode-only">
<img src="./scripts/logo-white.svg" style="height: 40px;">
</a>
<a href="https://blink.coder.com#gh-light-mode-only">
<img src="./scripts/logo-black.svg" style="height: 40px;">
</a>

[![discord](https://img.shields.io/discord/747933592273027093?label=discord)](https://discord.gg/coder)
![NPM Version](https://img.shields.io/npm/v/blink)
[![Documentation](https://img.shields.io/badge/documentation-blink.coder.com-blue)](https://blink.coder.com/docs)

Blink is a self-hosted platform for building and running custom, in-house AI agents. They respond via Slack, GitHub, and a browser-based UI. They are powerful chatbots that can search the web, run code in isolated environments, and securely access company data - all under your full control.

![Blink Demo](https://github.com/user-attachments/assets/7f272246-f4e3-4e94-9619-a91d2013db4a)

## Features

- 🖥️ **Web UI** where you can chat with agents
- 🛠️ **Blink SDK** - a set of libraries for building agents compatible with the Blink platform
- ⚙️ **Blink CLI** - a command-line tool for developing agents locally
- 🔍 **Observability** - use the web UI to view logs and traces
- 📦 **Docker-based deployment** - agents are deployed as Docker containers
- 🔒 **User and organization management** - invite your team to use and collaborate on agents
- 🤖 **Pre-built, fully-functional [Scout agent](./packages/scout-agent/README.md)**, which you can customize for your own use

## Get Started

### Requirements

- Node.js 22+ or Bun
- Docker (the server needs it to deploy agents)

### Install and run the Blink server

```sh
npm install -g blink-server
blink-server
```

Open the Blink web UI in your browser and create your first agent. Alternatively, you may run the server [with Docker](https://blink.coder.com/docs/server/docker-deployment).

## What's a Blink agent?

Agents are HTTP servers that respond to events. The Blink Server deploys them as Docker containers, routes messages from Slack/GitHub/web UI, and manages conversation state - your agent just defines how to respond.

```typescript
import { convertToModelMessages, streamText } from "ai";
import * as blink from "blink";

const agent = new blink.Agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: "anthropic/claude-opus-4.5",
    messages: convertToModelMessages(messages),
    system: "You are a helpful assistant.",
  });
});

agent.serve();
```

The `on("chat")` handler processes incoming messages. For tool calls, the server automatically loops back to your agent until the response is complete.

For a closer look at Blink agents, visit [blink.coder.com/docs](https://blink.coder.com/docs).

## Current State of the Project

We've been using Blink at [Coder](https://coder.com) for a few months now. We built in-house agents that:

- help our customers in Slack with questions related to the Coder product by analyzing the [coder/coder repository](https://github.com/coder/coder)
- automatically diagnose flaky tests in our CI pipeline, create [issues](https://github.com/coder/internal/issues/1278), and assign relevant engineers to fix them
- answer questions from our sales team by aggregating data from our CRM and sales tools

and more.

That being said, Blink is still in early access. You may encounter bugs and missing features. If you do, please [file an issue](https://github.com/coder/blink/issues/new).

## License

Server code is licensed under AGPLv3. Agent SDKs are licensed under MIT.
