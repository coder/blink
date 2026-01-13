import Client from "@blink.so/api";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import XDGAppPaths from "xdg-app-paths";
import chalk from "chalk";
import { spinner } from "@clack/prompts";
import open from "open";
import { openUrl } from "./util";

const DEFAULT_HOST = "https://blink.coder.com";

interface BlinkConfig {
  _?: string;
  token?: string;
  host?: string;
}

/**
 * Reads the full config from the auth file.
 */
function getConfig(testAuthPath?: string): BlinkConfig | undefined {
  const path = testAuthPath || getAuthTokenConfigPath();
  if (existsSync(path)) {
    const data = readFileSync(path, "utf8");
    return JSON.parse(data);
  }
  return undefined;
}

/**
 * Writes the full config to the auth file.
 */
function setConfig(config: BlinkConfig, testAuthPath?: string) {
  const path = testAuthPath || getAuthTokenConfigPath();
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(
    path,
    JSON.stringify({
      _: "This is your Blink credentials file. DO NOT SHARE THIS FILE WITH ANYONE!",
      ...config,
    })
  );
}

/**
 * Normalizes a host URL by ensuring https:// prefix and stripping trailing slashes.
 */
export function normalizeHost(url: string): string {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url.replace(/\/+$/, "");
}

/**
 * Converts an HTTP(S) URL to a WebSocket URL.
 */
export function toWsUrl(host: string): string {
  return host.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
}

/**
 * Gets the host URL for the Blink CLI.
 * Priority: BLINK_HOST env var → config file → default
 *
 * @param testAuthPath - Optional path for testing, overrides default auth path
 * @returns The host URL for the Blink CLI.
 */
export function getHost(testAuthPath?: string): string {
  return (
    process.env.BLINK_HOST ?? getConfig(testAuthPath)?.host ?? DEFAULT_HOST
  );
}

/**
 * Gets the auth token for the Blink CLI.
 *
 * @param testAuthPath - Optional path for testing, overrides default auth path
 * @returns The auth token for the Blink CLI.
 */
export function getAuthToken(testAuthPath?: string): string | undefined {
  return getConfig(testAuthPath)?.token;
}

/**
 * Sets the auth token for the Blink CLI.
 * @param token - The auth token to set.
 * @param testAuthPath - Optional path for testing, overrides default auth path
 */
export function setAuthToken(token: string, testAuthPath?: string) {
  const existing = getConfig(testAuthPath) ?? {};
  setConfig({ ...existing, token }, testAuthPath);
}

/**
 * Sets the host URL for the Blink CLI.
 * @param host - The host URL to set.
 * @param testAuthPath - Optional path for testing, overrides default auth path
 */
export function setHost(host: string, testAuthPath?: string) {
  const existing = getConfig(testAuthPath) ?? {};
  setConfig({ ...existing, host: normalizeHost(host) }, testAuthPath);
}

/**
 * Deletes the auth token for the Blink CLI.
 * @param testAuthPath - Optional path for testing, overrides default auth path
 */
export function deleteAuthToken(testAuthPath?: string) {
  const path = testAuthPath || getAuthTokenConfigPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function getAuthTokenConfigPath() {
  const dirs = XDGAppPaths("blink").dataDirs();
  if (dirs.length === 0) {
    throw new Error("No suitable data directory for Blink storage found!");
  }
  return join(dirs[0]!, "auth.json");
}

export async function loginIfNeeded(): Promise<string> {
  const host = getHost();
  const client = new Client({ baseURL: host });

  // Check for BLINK_TOKEN environment variable first (for CI)
  let token = process.env.BLINK_TOKEN || getAuthToken();

  if (token) {
    client.authToken = token;

    try {
      // Ensure that the token is valid.
      await client.users.me();
    } catch (_err) {
      // The token is invalid
      if (process.env.BLINK_TOKEN) {
        throw new Error("BLINK_TOKEN environment variable is invalid");
      }
      // Try to login again
      token = await login();
    }
  } else {
    token = await login();
  }

  return token;
}

interface StdinCleanup {
  cleanup: () => void;
}

/**
 * Sets up an Enter key listener on stdin without blocking.
 * Returns a cleanup function to remove the listener.
 */
function setupEnterKeyListener(onEnter: () => void): StdinCleanup {
  let cleaned = false;

  const dataHandler = (key: Buffer) => {
    // Check if Enter key was pressed (key code 13 or \r)
    if (key.toString() === "\r" || key.toString() === "\n") {
      onEnter();
    }
    // On ctrl+c, exit the process
    if (key.toString() === "\u0003") {
      cleanup();
      process.exit(1);
    }
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    try {
      process.stdin.removeListener("data", dataHandler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {
      // Ignore errors during cleanup
    }
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", dataHandler);

  return { cleanup };
}

/**
 * Login makes the CLI output the URL to authenticate with Blink.
 * It returns a valid auth token.
 * @param host - Optional host URL to authenticate against (will be saved to config)
 */
export async function login(host?: string): Promise<string> {
  // If host is provided, normalize and save it
  if (host) {
    setHost(host);
  }
  const effectiveHost = getHost();
  const client = new Client({ baseURL: effectiveHost });

  let authUrl: string | undefined;
  let browserOpened = false;

  // Promise that resolves once authUrl is initialized
  let resolveAuthUrlInitialized: () => void;
  const authUrlInitializedPromise = new Promise<void>((resolve) => {
    resolveAuthUrlInitialized = resolve;
  });

  // Start the auth process - this returns a promise for the token
  const tokenPromise = client.auth.token((url: string, _id: string) => {
    authUrl = url;
    console.log("Visit", chalk.bold(url), "to authenticate with Blink.");
    console.log(chalk.dim("Press [ENTER] to open the browser"));

    // Signal that authUrl is now available
    resolveAuthUrlInitialized();
  });

  // Setup Enter key listener (non-blocking)
  const stdinCleanup = setupEnterKeyListener(async () => {
    if (!browserOpened) {
      browserOpened = true;

      // Wait for authUrl to be initialized before opening
      await authUrlInitializedPromise;
      await openUrl(authUrl!);
    }
  });

  await authUrlInitializedPromise;
  // Show spinner while waiting for authentication
  const s = spinner();
  s.start("Waiting for authentication...");

  try {
    // Wait for the token
    const receivedToken = await tokenPromise;

    // Cleanup stdin
    stdinCleanup.cleanup();

    client.authToken = receivedToken as string;

    const user = await client.users.me();
    s.stop(`Congratulations, you are now signed in as ${user.email}!`);
    console.log("");

    // Save the token
    setAuthToken(receivedToken as string);

    return receivedToken as string;
  } catch (error) {
    // Cleanup stdin
    stdinCleanup.cleanup();

    s.stop(`Authentication failed: ${error}`);
    process.exit(1);
  }
}
