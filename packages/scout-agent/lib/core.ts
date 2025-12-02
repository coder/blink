import util from "node:util";
import type { ModelMessage, ProviderOptions } from "@ai-sdk/provider-utils";
import type * as github from "@blink-sdk/github";
import withModelIntent from "@blink-sdk/model-intent";
import * as slack from "@blink-sdk/slack";
import type { App } from "@slack/bolt";
import { convertToModelMessages, type LanguageModel, type Tool } from "ai";
import type * as blink from "blink";
import {
  type DaytonaClient,
  type DaytonaWorkspaceInfo,
  getDaytonaWorkspaceClient,
  initializeDaytonaWorkspace,
} from "./compute/daytona/index";
import {
  type DockerWorkspaceInfo,
  getDockerWorkspaceClient,
  initializeDockerWorkspace,
} from "./compute/docker";
import { createComputeTools } from "./compute/tools";
import {
  createGitHubTools,
  githubAppContextFactory,
  handleGitHubWebhook,
} from "./github";
import { defaultSystemPrompt } from "./prompt";
import { createSlackApp, createSlackTools, getSlackMetadata } from "./slack";
import type { Message } from "./types";
import { createWebSearchTools } from "./web-search";

type Tools = Partial<ReturnType<typeof createSlackTools>> &
  Partial<ReturnType<typeof createGitHubTools>> &
  Record<string, Tool>;

type NullableTools = { [K in keyof Tools]: Tools[K] | undefined };

type ConfigFields<T> = { [K in keyof T]: T[K] | undefined };

export interface BuildStreamTextParamsOptions {
  messages: Message[];
  chatID: blink.ID;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  tools?: NullableTools;
  systemPrompt?: string;
  /**
   * A function that returns the GitHub auth context for the GitHub tools and for Git authentication inside workspaces.
   * If not provided, the GitHub auth context will be created using the app ID and private key from the GitHub config.
   */
  getGithubAppContext?: () => Promise<github.AppAuthOptions | undefined>;
}

interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface GitHubConfig {
  appID: string;
  privateKey: string;
  webhookSecret: string;
}

interface SlackConfig {
  botToken: string;
  signingSecret: string;
}

interface WebSearchConfig {
  exaApiKey: string;
}

export interface DaytonaConfig {
  apiKey: string;
  computeServerPort: number;
  /** The snapshot must initialize the Blink compute server on `computeServerPort`. */
  snapshot: string;
  /** Default is 60. */
  autoDeleteIntervalMinutes?: number;
  envVars?: Record<string, string>;
  labels?: Record<string, string>;
  /** Optional Daytona SDK client for testing. If not provided, a real client is created. */
  daytonaSdk?: DaytonaClient;
}

type ComputeConfig =
  | { type: "docker" }
  | { type: "daytona"; options: DaytonaConfig };

const loadConfig = <K extends readonly string[]>(
  input: ConfigFields<Record<K[number], string>> | undefined,
  fields: K
):
  | {
      config: Record<K[number], string>;
      warningMessage?: undefined;
    }
  | {
      config?: undefined;
      warningMessage?: string;
    } => {
  // If no config provided at all, return without warning
  if (input === undefined) {
    return {};
  }
  const missingFields = [];
  for (const field of fields) {
    if (input?.[field as K[number]] === undefined) {
      missingFields.push(field);
    }
  }
  if (missingFields.length > 0) {
    if (missingFields.length === 1) {
      return {
        warningMessage: `The \`${missingFields[0]}\` config field is undefined.`,
      };
    }
    const oxfordComma = missingFields.length > 2 ? "," : "";
    const prefixFields = missingFields
      .slice(0, -1)
      .map((field) => `\`${field}\``)
      .join(", ");
    const lastField = `${oxfordComma} and \`${missingFields[missingFields.length - 1]}\``;

    return {
      warningMessage: `The ${prefixFields}${lastField} config fields are undefined.`,
    };
  }
  return {
    config: fields.reduce(
      (acc, field) => {
        acc[field as K[number]] = input?.[field as K[number]] as string;
        return acc;
      },
      {} as Record<K[number], string>
    ),
  };
};

export interface ScoutOptions {
  agent: blink.Agent<Message>;
  github?: ConfigFields<GitHubConfig>;
  slack?: ConfigFields<SlackConfig>;
  webSearch?: ConfigFields<WebSearchConfig>;
  compute?: ComputeConfig;
  logger?: Logger;
}

export class Scout {
  private readonly agent: blink.Agent<Message>;
  private readonly github:
    | { config: GitHubConfig; warningMessage?: undefined }
    | { config?: undefined; warningMessage?: string };
  private readonly slack:
    | {
        config: SlackConfig;
        app: App;
        receiver: slack.Receiver;
        warningMessage?: undefined;
      }
    | {
        config?: undefined;
        app?: undefined;
        receiver?: undefined;
        warningMessage?: string;
      };
  private readonly webSearch:
    | { config: WebSearchConfig; warningMessage?: undefined }
    | { config?: undefined; warningMessage?: string };
  private readonly compute:
    | { config: ComputeConfig; warningMessage?: undefined }
    | { config?: undefined; warningMessage?: string };

  private readonly logger: Logger;

  constructor(options: ScoutOptions) {
    this.agent = options.agent;
    this.github = loadConfig(options.github, [
      "appID",
      "privateKey",
      "webhookSecret",
    ] as const);
    const slackConfigResult = loadConfig(options.slack, [
      "botToken",
      "signingSecret",
    ] as const);
    if (slackConfigResult.config) {
      // this is janky
      // TODO: figure out a better way to mock slack for testing
      if (slackConfigResult.config.botToken === "test") {
        this.slack = {
          config: slackConfigResult.config,
          app: { client: null },
          receiver: undefined,
          // biome-ignore lint/suspicious/noExplicitAny: todo: this needs to be fixed
        } as any;
      } else {
        const { app, receiver } = createSlackApp({
          agent: this.agent,
          slackSigningSecret: slackConfigResult.config.signingSecret,
          slackBotToken: slackConfigResult.config.botToken,
        });
        this.slack = {
          config: slackConfigResult.config,
          app,
          receiver,
        };
      }
    } else {
      this.slack = { warningMessage: slackConfigResult.warningMessage };
    }
    this.webSearch = loadConfig(options.webSearch, ["exaApiKey"] as const);
    this.compute = options.compute ? { config: options.compute } : {};
    this.logger = options.logger ?? console;
  }

  async handleSlackWebhook(request: Request): Promise<Response> {
    if (this.slack.config === undefined) {
      this.logger.warn(
        `Slack is not configured but received a Slack webhook. ${this.slack.warningMessage} Did you provide all required environment variables?`
      );
      return new Response("Slack is not configured", { status: 503 });
    }
    return this.slack.receiver.handle(request);
  }

  async handleGitHubWebhook(request: Request): Promise<Response> {
    if (this.github.config === undefined) {
      this.logger.warn(
        `Received a GitHub webhook but GitHub is not configured. ${this.github.warningMessage} Did you provide all required environment variables?`
      );
      return new Response("GitHub is not configured", { status: 503 });
    }
    return handleGitHubWebhook({
      request,
      agent: this.agent,
      githubWebhookSecret: this.github.config.webhookSecret,
      logger: this.logger,
    });
  }

  private printConfigWarnings() {
    const warnings = [];
    if (this.github.warningMessage !== undefined) {
      warnings.push(
        `GitHub is not configured. ${this.github.warningMessage} You may remove the \`github\` config object to suppress this warning.`
      );
    }
    if (this.slack.warningMessage !== undefined) {
      warnings.push(
        `Slack is not configured. ${this.slack.warningMessage} You may remove the \`slack\` config object to suppress this warning.`
      );
    }
    if (this.webSearch.warningMessage !== undefined) {
      warnings.push(
        `Web search is not configured. ${this.webSearch.warningMessage} You may remove the \`webSearch\` config object to suppress this warning.`
      );
    }
    if (warnings.length > 0) {
      this.logger.warn(
        `${warnings.join("\n")}\n\nDid you provide all required environment variables?`
      );
    }
  }

  async buildStreamTextParams({
    messages,
    chatID,
    model,
    providerOptions,
    tools: providedTools,
    getGithubAppContext,
    systemPrompt = defaultSystemPrompt,
  }: BuildStreamTextParamsOptions): Promise<{
    model: LanguageModel;
    messages: ModelMessage[];
    maxOutputTokens: number;
    providerOptions?: ProviderOptions;
    tools: Tools;
  }> {
    this.printConfigWarnings();

    // Resolve the GitHub app context once for all tools
    const githubAppContext = this.github.config
      ? await (
          getGithubAppContext ??
          githubAppContextFactory({
            appId: this.github.config.appID,
            privateKey: this.github.config.privateKey,
          })
        )()
      : undefined;

    const slackMetadata = getSlackMetadata(messages);
    const respondingInSlack =
      this.slack.app !== undefined && slackMetadata !== undefined;

    let computeTools: Record<string, Tool> = {};
    const computeConfig = this.compute.config;
    switch (computeConfig?.type) {
      case "docker": {
        computeTools = createComputeTools<DockerWorkspaceInfo>({
          agent: this.agent,
          githubAppContext,
          initializeWorkspace: initializeDockerWorkspace,
          createWorkspaceClient: getDockerWorkspaceClient,
        });
        break;
      }
      case "daytona": {
        const opts = computeConfig.options;
        computeTools = createComputeTools<DaytonaWorkspaceInfo>({
          agent: this.agent,
          githubAppContext,
          initializeWorkspace: (info) =>
            initializeDaytonaWorkspace(
              this.logger,
              {
                daytonaApiKey: opts.apiKey,
                snapshot: opts.snapshot,
                autoDeleteIntervalMinutes: opts.autoDeleteIntervalMinutes,
                envVars: opts.envVars,
                labels: opts.labels,
                daytonaSdk: opts.daytonaSdk,
              },
              info
            ),
          createWorkspaceClient: (info) =>
            getDaytonaWorkspaceClient(
              {
                daytonaApiKey: opts.apiKey,
                computeServerPort: opts.computeServerPort,
                daytonaSdk: opts.daytonaSdk,
              },
              info
            ),
        });
        break;
      }
      case undefined: {
        // No compute configured, leave computeTools empty
        break;
      }
      default: {
        // exhaustiveness check
        computeConfig satisfies never;
        throw new Error(
          `unexpected compute config: ${util.inspect(computeConfig)}`
        );
      }
    }

    const tools = {
      ...(this.webSearch.config
        ? createWebSearchTools({ exaApiKey: this.webSearch.config.exaApiKey })
        : {}),
      ...(respondingInSlack
        ? createSlackTools({ slackApp: this.slack.app })
        : {}),
      ...(this.github.config
        ? createGitHubTools({
            agent: this.agent,
            chatID,
            githubAppContext,
          })
        : undefined),
      ...computeTools,
      ...providedTools,
    };

    if (respondingInSlack) {
      systemPrompt += `
Very frequently report your Slack status - you can report it in parallel as you run other tools.
  
<formatting-rules>
${slack.formattingRules}
</formatting-rules>`;
    }

    const converted = convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    });

    converted.unshift({
      role: "system",
      content: systemPrompt,
      providerOptions,
    });

    const lastMessage = converted[converted.length - 1];
    if (!lastMessage) {
      throw new Error("No last message found");
    }
    lastMessage.providerOptions = providerOptions;

    return {
      model,
      messages: converted,
      maxOutputTokens: 64_000,
      providerOptions,
      tools: withModelIntent(tools),
    };
  }
}
