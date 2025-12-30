import { spawn } from "child_process";
import { createServer } from "net";
import * as logger from "./logger";

const CONTAINER_NAME = "blink-server-postgres";
const POSTGRES_PASSWORD = "blink-server-dev-password";
const POSTGRES_USER = "postgres";
const POSTGRES_DB = "blink";
const POSTGRES_PORT = 54321;

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (error) => {
      reject(error);
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

async function isDockerRunning(): Promise<boolean> {
  try {
    await runCommand("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

async function getContainerStatus(): Promise<
  "running" | "stopped" | "not-found"
> {
  try {
    const output = await runCommand("docker", [
      "ps",
      "-a",
      "--filter",
      `name=^${CONTAINER_NAME}$`,
      "--format",
      "{{.State}}",
    ]);

    if (!output) {
      return "not-found";
    }

    return output === "running" ? "running" : "stopped";
  } catch {
    return "not-found";
  }
}

async function startExistingContainer(): Promise<void> {
  logger.plain(`Starting existing PostgreSQL container: ${CONTAINER_NAME}`);
  await runCommand("docker", ["start", CONTAINER_NAME]);

  // Wait for PostgreSQL to be ready
  await waitForPostgres();
}

async function createAndStartContainer(): Promise<void> {
  logger.plain(`Creating PostgreSQL container: ${CONTAINER_NAME}`);

  const portAvailable = await isPortAvailable(POSTGRES_PORT);
  if (!portAvailable) {
    throw new Error(
      `Port ${POSTGRES_PORT} is already in use. Please free the port or set POSTGRES_URL manually.`
    );
  }

  await runCommand("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "--restart",
    "unless-stopped",
    "-e",
    `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${POSTGRES_DB}`,
    "-p",
    `${POSTGRES_PORT}:5432`,
    "pgvector/pgvector:pg17",
  ]);

  logger.plain("PostgreSQL container created");

  // Wait for PostgreSQL to be ready
  await waitForPostgres();
}

async function waitForPostgres(): Promise<void> {
  logger.plain("Waiting for PostgreSQL to be ready...");

  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await runCommand("docker", [
        "exec",
        CONTAINER_NAME,
        "pg_isready",
        "-U",
        POSTGRES_USER,
      ]);
      logger.plain("PostgreSQL is ready");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error("PostgreSQL failed to become ready in time");
}

async function promptUser(question: string): Promise<boolean> {
  logger.plain(question);
  process.stdout.write("(y/n): ");

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (key: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);

      console.log(key);

      if (key === "y" || key === "Y") {
        resolve(true);
      } else {
        resolve(false);
      }
    };

    stdin.on("data", onData);
  });
}

export async function ensurePostgres(): Promise<string> {
  // Check if Docker is running
  const dockerRunning = await isDockerRunning();
  if (!dockerRunning) {
    throw new Error(
      "Docker is not running. Please start Docker or set POSTGRES_URL manually."
    );
  }

  const status = await getContainerStatus();

  if (status === "running") {
    logger.info(
      `Using Docker PostgreSQL '${CONTAINER_NAME}' because POSTGRES_URL is not set`
    );
    return getConnectionString();
  }

  if (status === "stopped") {
    await startExistingContainer();
    logger.info(
      `Using Docker PostgreSQL '${CONTAINER_NAME}' because POSTGRES_URL is not set`
    );
    return getConnectionString();
  }

  // Container doesn't exist, ask user if they want to create it
  const shouldCreate = await promptUser(
    "No PostgreSQL container found. Create one with Docker?"
  );

  if (!shouldCreate) {
    throw new Error(
      "PostgreSQL is required. Please set POSTGRES_URL manually."
    );
  }

  await createAndStartContainer();
  logger.info(
    `Using Docker PostgreSQL '${CONTAINER_NAME}' because POSTGRES_URL is not set`
  );
  return getConnectionString();
}

export function getConnectionString(): string {
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}`;
}
