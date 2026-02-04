import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import Client from "@blink.so/api";
import { isCancel, spinner, text } from "@clack/prompts";
import chalk from "chalk";
import XDGAppPaths from "xdg-app-paths";
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
    const parsed = JSON.parse(data);
    // When Blink was first released, the host would always be the default host
    // and was not stored in the config file. This is a fallback for older config files.
    if (!parsed.host) {
      parsed.host = DEFAULT_HOST;
    }
    return parsed;
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
 * Checks if a hostname is localhost or an IP address.
 */
function isLocalhostOrIP(hostname: string): boolean {
  if (hostname === "localhost") return true;
  // IPv4 pattern
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 pattern (simplified - covers most common cases)
  if (/^[\da-fA-F:]+$/.test(hostname) && hostname.includes(":")) return true;
  return false;
}

/**
 * Normalizes a host URL by ensuring protocol prefix, stripping paths and trailing slashes.
 * Defaults to https:// unless the host is localhost or an IP address (then http://).
 */
export function normalizeHost(url: string): string {
  let protocol = "";
  let rest = url;

  if (url.startsWith("http://")) {
    protocol = "http://";
    rest = url.slice(7);
  } else if (url.startsWith("https://")) {
    protocol = "https://";
    rest = url.slice(8);
  }

  // Extract just the host (and optional port), stripping any path
  const slashIndex = rest.indexOf("/");
  const hostWithPort = slashIndex === -1 ? rest : rest.slice(0, slashIndex);

  // Extract hostname without port for localhost/IP check
  // Check if there's a port at the end (colon followed by digits only)
  const portMatch = hostWithPort.match(/:(\d+)$/);
  const hostname = portMatch
    ? hostWithPort.slice(0, hostWithPort.length - portMatch[0].length)
    : hostWithPort;

  // If no protocol was provided, determine the default
  if (!protocol) {
    protocol = isLocalhostOrIP(hostname) ? "http://" : "https://";
  }

  return protocol + hostWithPort;
}

/**
 * Converts an HTTP(S) URL to a WebSocket URL.
 */
export function toWsUrl(host: string): string {
  return host.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
}

/**
 * Gets the host URL for the Blink CLI.
 * Priority: BLINK_HOST env var → config file → undefined
 *
 * @param testAuthPath - Optional path for testing, overrides default auth path
 * @returns The host URL for the Blink CLI, or undefined if not configured.
 */
export function getHost(testAuthPath?: string): string | undefined {
  const host = process.env.BLINK_HOST ?? getConfig(testAuthPath)?.host;
  return host ? normalizeHost(host) : undefined;
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

export async function loginIfNeeded(host?: string): Promise<string> {
  if (host) {
    setHost(host);
  }
  // If host is not configured, prompt for it or show help message
  host = getHost();
  if (!host) {
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (!isInteractive) {
      throw new Error(
        "No Blink host configured. Set the BLINK_HOST environment variable or run `blink login <host>` interactively."
      );
    }

    // Prompt for the host URL
    const hostInput = await text({
      message: "Enter your Blink host URL:",
      placeholder: "https://blink.example.com",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Host URL is required";
        }
      },
    });

    if (isCancel(hostInput)) {
      throw new Error("Login cancelled");
    }

    setHost(hostInput as string);
    host = getHost();
    if (!host) {
      throw new Error("Failed to save host configuration");
    }
  }

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
      token = await login(host);
    }
  } else {
    token = await login(host);
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
  if (!effectiveHost) {
    throw new Error(
      "No Blink host configured. Set the BLINK_HOST environment variable or run `blink login <host>`."
    );
  }
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
      if (!authUrl) {
        throw new Error("Authentication URL not set, this is a bug.");
      }
      await openUrl(authUrl);
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
