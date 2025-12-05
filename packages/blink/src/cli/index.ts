#!/usr/bin/env node

import { WebSocket } from "ws";

// Older versions of NodeJS don't have a global WebSocket object.
if (!globalThis.WebSocket) {
  // @ts-ignore - types are wrong. This accepts the properties.
  globalThis.WebSocket = WebSocket;
}

// Bun does not support this, so it simply prevents
// a really annoying "Not implemented" error.
if (typeof globalThis["Bun"] !== "undefined") {
  const perfHooks = require("perf_hooks");
  perfHooks.monitorEventLoopDelay = () => {
    return {
      enable: () => {},
    };
  };
}

import { program } from "commander";
import { randomUUID } from "crypto";
import { version } from "../../package.json";
import build from "./build";
import deploy from "./deploy";
import setupSlackApp from "./setup-slack-app";
import setupGithubApp from "./setup-github-app";
import * as clack from "@clack/prompts";

// This polyfill is because older versions of NodeJS don't have a global crypto object.
if (!globalThis.crypto) {
  // @ts-ignore - types are wrong. This accepts the properties.
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  // @ts-ignore - types are wrong. This accepts the properties.
  globalThis.crypto.randomUUID = () => {
    return randomUUID();
  };
}

program
  .name("blink")
  .description("Blink is a runtime for building and deploying AI agents.")
  .version(version)
  .action(() => {
    program.outputHelp();
  });

const asyncEntry = (
  entry: () => Promise<{ default: (...args: any[]) => void }>
) => {
  return async (...args: any[]) => {
    const { default: entrypoint } = await entry();
    return entrypoint(...args);
  };
};

program
  .command("init [directory]")
  .description("Initialize a new Blink agent.")
  .action(asyncEntry(() => import("./init")));

program
  .command("dev [directory] [options]")
  .description("Start a development server for your agent.")
  .action(asyncEntry(() => import("./dev")));

program
  .command("deploy [directory]")
  .description("Deploy your agent to the Blink Cloud.")
  .option("-m, --message <message>", "Message for this deployment")
  .action(deploy);

program
  .command("build [directory]")
  .description("Build your agent for production.")
  .action(build);

const setupCommand = program
  .command("setup")
  .description("Set up integrations for your agent.");

setupCommand
  .command("slack-app [directory]")
  .description("Set up Slack app integration")
  .action(setupSlackApp);

setupCommand
  .command("github-app [directory]")
  .description("Set up GitHub App integration")
  .action(setupGithubApp);

program
  .command("telemetry [boolean]")
  .description("Enable or disable telemetry.");

program
  .command("start [directory]")
  .description(
    "Starts the Blink runtime in production mode. The agent must be compiled with `blink build` first."
  );

// Hidden commands go below here.

program
  .command("run <message...>")
  .description("Run your agent programmatically and get the response.")
  .option(
    "-d, --directory <directory>",
    "Directory to run the agent from (default: current directory)"
  )
  .option("-c, --chat <chat>", "Chat key to use (default: 'default')")
  .action(asyncEntry(() => import("./run")));

program
  .command("connect", {
    hidden: true,
  })
  .description("Connect compute to the Blink Cloud.")
  .action(asyncEntry(() => import("./connect")));

program
  .command("chat", {
    hidden: true,
  })
  .description("Start a Blink chat connected to your machine.")
  .action(asyncEntry(() => import("./chat")));

program
  .command("login")
  .description("Log in to the Blink Cloud.")
  .action(asyncEntry(() => import("./login")));

const computeCommand = program
  .command("compute")
  .description("Compute-related commands.");

computeCommand
  .command("server")
  .description("Run a compute protocol server on localhost.")
  .action(asyncEntry(() => import("./compute-server")));

// Configure error output
program.configureOutput({
  writeErr: (str) => {
    // Strip ANSI codes from commander's default error messages
    const cleanStr = str.replace(/\x1b\[[0-9;]*m/g, "");
    clack.log.error(cleanStr.trim());
  },
});

// Global error handler for uncaught errors in command actions
process.on("unhandledRejection", (error: any) => {
  clack.log.error(error?.message || String(error));
  process.exit(1);
});

program.parse(process.argv);
