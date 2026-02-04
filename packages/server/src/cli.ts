#!/usr/bin/env node

import boxen from "boxen";
import chalk from "chalk";
import { Command } from "commander";
import { version as packageVersion } from "../package.json";
import {
  CLI_OPTION_DEFINITIONS,
  getOrGenerateAuthSecret,
  type ResolvedCliOptions,
} from "./config";
import {
  buildOptionDescription,
  optionKeys,
  type RawCliOptions,
  resolveOptions,
} from "./config/cli-parser";
import * as logger from "./logger";
import { ensurePostgres } from "./postgres";
import { startServer } from "./server";
import { startTunnelProxy } from "./tunnel";

declare const __GIT_SHA__: string | undefined;
const versionSuffix = typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "dev";
const version = `${packageVersion}+${versionSuffix}`;

const program = new Command();

program
  .name("blink-server")
  .description(`Blink Server v${version}`)
  .version(version);

for (const key of optionKeys) {
  const spec = CLI_OPTION_DEFINITIONS[key];
  const option = program.createOption(spec.flags, buildOptionDescription(spec));
  if ("hidden" in spec && spec.hidden) {
    option.hideHelp();
  }
  program.addOption(option);
}

program.action(async (options) => {
  try {
    await runServer(resolveOptions(options as RawCliOptions));
  } catch (error) {
    logger.error(
      error instanceof Error ? error.message : "An unknown error occurred"
    );
    process.exit(1);
  }
});

async function runServer(options: ResolvedCliOptions) {
  console.log(chalk.bold("blink■"), version, chalk.gray("agents as a service"));

  // Resolve configuration.
  let postgresUrl = options.postgresUrl;

  if (!postgresUrl) {
    postgresUrl = await ensurePostgres();
  }

  const authSecret = options.authSecret ?? getOrGenerateAuthSecret();

  const baseUrlHost = options.host === "0.0.0.0" ? "localhost" : options.host;
  const baseUrl = `http://${baseUrlHost}:${options.port}`;

  const devProxy = options.dev;

  // Determine access URL - use configured access URL if set, otherwise create devhook.
  let accessUrl: string;
  let tunnelCleanup: (() => void) | undefined;
  const tunnelServerUrl = options.tunnelServerUrl;
  const accessUrlOverride = options.accessUrl;
  if (accessUrlOverride) {
    accessUrl = accessUrlOverride;
  } else {
    const tunnel = await startTunnelProxy(tunnelServerUrl, options.port);
    accessUrl = tunnel.accessUrl;
    tunnelCleanup = tunnel[Symbol.dispose];
    logger.info(
      `Opening tunnel so external services can send webhooks to your deployment. For production scenarios, specify an external access URL`
    );
  }

  if (!/^https?:\/\//.test(accessUrl)) {
    throw new Error(
      `Invalid access URL: ${accessUrl}. Must start with http:// or https://`
    );
  }

  const cleanup = () => {
    tunnelCleanup?.();
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  // Start the server
  const _srv = await startServer({
    host: options.host,
    port: options.port,
    postgresUrl,
    authSecret,
    baseUrl,
    devProxy,
    accessUrl,
    wildcardAccessUrl: options.wildcardAccessUrl,
    agentImage: options.agentImage,
    devhookDisableAuth: options.devhookDisableAuth,
    enableSignups: options.enableSignups,
    enableOauth: false,
  });

  const box = boxen(
    ["View the Web UI:", chalk.magenta.underline(accessUrl)].join("\n"),
    {
      borderColor: "cyan",
      padding: {
        left: 4,
        right: 4,
      },
      textAlignment: "center",
    }
  );
  console.log(box);
}

program.parse();
