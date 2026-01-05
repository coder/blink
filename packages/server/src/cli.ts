#!/usr/bin/env node

import boxen from "boxen";
import chalk from "chalk";
import { Command } from "commander";
import { version } from "../package.json";
import { startTunnelProxy } from "./tunnel";
import * as logger from "./logger";
import { ensurePostgres } from "./postgres";
import { startServer } from "./server";

const program = new Command();

program
  .name("blink-server")
  .description("Self-hosted Blink server")
  .version(version)
  .option("-p, --port <port>", "Port to run the server on", "3005")
  .option(
    "-d, --dev [host]",
    "Proxy frontend requests to Next.js dev server (default: localhost:3000)"
  )
  .action(async (options) => {
    try {
      await runServer(options);
    } catch (error) {
      console.error(error, error instanceof Error ? error.stack : undefined);
      logger.error(
        error instanceof Error ? error.message : "An unknown error occurred"
      );
      process.exit(1);
    }
  });

async function runServer(options: { port: string; dev?: boolean | string }) {
  const port = parseInt(options.port, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  console.log(chalk.bold("blink■"), version, chalk.gray("agents as a service"));

  // Check and setup environment variables
  let postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!postgresUrl) {
    postgresUrl = await ensurePostgres();
  }

  // Generate or use existing AUTH_SECRET
  if (!process.env.AUTH_SECRET) {
    process.env.AUTH_SECRET = "fake-random-string-should-be-in-db";
  }
  const authSecret = process.env.AUTH_SECRET;

  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

  const devProxy = options.dev
    ? options.dev === true
      ? "localhost:3000"
      : options.dev
    : undefined;

  // Determine access URL - use BLINK_ACCESS_URL if set, otherwise create devhook
  let accessUrl: string;
  let tunnelCleanup: (() => void) | undefined;
  const tunnelServerUrl =
    process.env.TUNNEL_SERVER_URL ?? "https://try.blink.host";
  if (process.env.BLINK_ACCESS_URL) {
    accessUrl = process.env.BLINK_ACCESS_URL;
  } else {
    const tunnel = await startTunnelProxy(tunnelServerUrl, port);
    accessUrl = tunnel.accessUrl;
    tunnelCleanup = tunnel[Symbol.dispose];
  }

  const cleanup = () => {
    tunnelCleanup?.();
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  // Start the server
  const _srv = await startServer({
    port,
    postgresUrl,
    authSecret,
    baseUrl,
    devProxy,
    accessUrl,
  });

  const box = boxen(
    [
      "View the Web UI:",
      chalk.magenta.underline(accessUrl),
      "",
      `Set ${chalk.bold(`BLINK_API_URL=${accessUrl}`)} when using the Blink CLI.`,
    ].join("\n"),
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
