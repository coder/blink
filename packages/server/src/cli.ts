#!/usr/bin/env node

import boxen from "boxen";
import chalk from "chalk";
import { Command } from "commander";
import { version } from "../package.json";
import * as logger from "./logger";
import { ensurePostgres } from "./postgres";
import { startServer } from "./server";

const program = new Command();

program
  .name("blink-server")
  .description("Self-hosted Blink server")
  .version(version)
  .option("-p, --port <port>", "Port to run the server on", "3005")
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

async function runServer(options: { port: string }) {
  const port = parseInt(options.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  console.log(chalk.bold("blink■"), version, chalk.gray("agents as a service"));

  // Check and setup environment variables
  let postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!postgresUrl) {
    postgresUrl = await ensurePostgres();
  }

  // Generate or use existing AUTH_SECRET
  const authSecret =
    process.env.AUTH_SECRET || "fake-random-string-should-be-in-db";

  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

  // Start the server
  const srv = await startServer({
    port,
    postgresUrl,
    authSecret,
    baseUrl,
  });

  const box = boxen(
    [
      "View the Web UI:",
      chalk.magenta.underline(baseUrl),
      "",
      `Set ${chalk.bold("BLINK_API_URL=" + baseUrl)} when using the Blink CLI.`,
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
