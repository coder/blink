# @blink-sdk/scout-agent

Scout is a foundation for quickly building AI agents that respond in Slack and GitHub, search the web, and run code in isolated environments. You can extend Scout with your own tools to build custom agents, or disable features you don't need.

## Installation

```bash
bun add @blink-sdk/scout-agent
```

## Quick Start

The following example is a fully-functional agent that responds in Slack and GitHub, searches the web, and runs code in isolated environments.

```typescript
import { Scout } from "@blink-sdk/scout-agent";
import * as blink from "blink";
import { streamText } from "ai";

// Create a Blink agent
const agent = new blink.Agent<Message>();

// Initialize Scout with desired integrations
const scout = new Scout({
  agent,
  github: {
    appID: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY, // base64 encoded
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  },
  webSearch: {
    exaApiKey: process.env.EXA_API_KEY,
  },
  compute: { type: "docker" },
});

// Handle webhooks
agent.on("request", async (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/slack")) {
    return scout.handleSlackWebhook(request);
  }
  if (url.pathname.startsWith("/github")) {
    return scout.handleGitHubWebhook(request);
  }
});

// Handle chat messages
agent.on("chat", async ({ id, messages }) => {
  const params = await scout.buildStreamTextParams({
    messages,
    chatID: id,
    model: "anthropic/claude-opus-4.5",
  });
  return streamText(params);
});
```

## Integrations

All integrations are optional - include only what you need.

### ScoutOptions

| Option      | Type                   | Required | Description                             |
| ----------- | ---------------------- | -------- | --------------------------------------- |
| `agent`     | `blink.Agent<Message>` | Yes      | Blink agent instance                    |
| `github`    | `GitHubConfig`         | No       | GitHub App configuration                |
| `slack`     | `SlackConfig`          | No       | Slack App configuration                 |
| `webSearch` | `WebSearchConfig`      | No       | Exa web search configuration            |
| `compute`   | `ComputeConfig`        | No       | Docker or Daytona compute configuration |
| `logger`    | `Logger`               | No       | Custom logger instance                  |

### GitHub

Scout provides full GitHub integration including:

- **Pull Request Management**: Create, update, and manage PRs
- **Webhook Handling**: Respond to PR merges, reviews, comments, and check runs
- **Repository Operations**: Read files, create branches, commit changes
- **GitHub App Authentication**: Secure authentication via GitHub Apps

Webhook events are automatically routed back to the originating chat conversation.

```typescript
{
  appID: string; // GitHub App ID
  privateKey: string; // GitHub App private key (base64 encoded)
  webhookSecret: string; // Webhook verification secret
}
```

### Slack

- **App Mentions**: Respond when mentioned in channels
- **Direct Messages**: Handle DMs to the bot
- **Thread Conversations**: Maintain context in threaded replies
- **Status Updates**: Post progress updates to Slack threads

```typescript
{
  botToken: string; // Slack bot OAuth token
  signingSecret: string; // Slack signing secret for webhook verification
}
```

### Web Search

Query the web using the Exa API.

```typescript
{
  exaApiKey: string; // Exa API key
}
```

### Compute

Execute code in isolated environments:

- **Workspace Initialization**: Create and configure compute environments
- **Git Authentication**: Authenticate Git with GitHub App tokens
- **Process Execution**: Run shell commands with stdout/stderr capture
- **File Operations**: Read, write, and manage files in the workspace

**Docker (local containers):**

```typescript
{
  type: "docker";
}
```

**Daytona (cloud sandboxes):**

```typescript
{
  type: "daytona",
  options: {
    apiKey: string                    // Daytona API key
    computeServerPort: number         // Port for compute server
    snapshot: string                  // Snapshot with Blink compute server
    autoDeleteIntervalMinutes?: number // Auto-cleanup interval (default: 60)
    envVars?: Record<string, string>  // Environment variables for sandboxes
    labels?: Record<string, string>   // Labels for sandboxes
  }
}
```

## API Reference

### Scout Class

#### Constructor

```typescript
new Scout(options: ScoutOptions)
```

#### Methods

**`handleSlackWebhook(request: Request): Promise<Response>`**

Process incoming Slack webhook requests. Handles app mentions and direct messages.

**`handleGitHubWebhook(request: Request): Promise<Response>`**

Process incoming GitHub webhook requests. Routes events to associated chat conversations.

**`buildStreamTextParams(options: BuildStreamTextParamsOptions): Promise<StreamTextParams>`**

Build parameters for the AI SDK's `streamText()` function with all configured tools.

```typescript
interface BuildStreamTextParamsOptions {
  messages: Message[]; // Chat messages
  chatID: string; // Chat conversation ID
  model: LanguageModel; // AI model to use
  tools?: Tools; // Additional custom tools
  maxOutputTokens?: number; // Max tokens (default: 16000)
  providerOptions?: ProviderOptions;
  getGithubAppContext?: () => Promise<GitHubAppContext | undefined>;
}
```

Returns:

```typescript
{
  model: LanguageModel
  messages: ModelMessage[]
  maxOutputTokens: number
  providerOptions?: ProviderOptions
  tools: Tools  // Combined built-in and custom tools
}
```

## Tools Provided

When configured, Scout provides these tools to the AI agent:

| Category   | Tools                             | Description                                  |
| ---------- | --------------------------------- | -------------------------------------------- |
| GitHub     | `github_*`                        | Repository operations, PR management, issues |
| Slack      | `slack_*`                         | Message sending, thread management           |
| Web Search | `web_search`                      | Query the web via Exa                        |
| Compute    | `initialize_workspace`            | Create compute environment                   |
| Compute    | `workspace_authenticate_git`      | Set up Git authentication                    |
| Compute    | `process_execute`, `process_wait` | Run shell commands                           |
| Compute    | `file_*`, `directory_*`           | File system operations                       |

## License

See the root of the repository for license information.
