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

/**
 * Gets the auth token for the Blink CLI.
 *
 * @param testAuthPath - Optional path for testing, overrides default auth path
 * @returns The auth token for the Blink CLI.
 */
export function getAuthToken(testAuthPath?: string): string | undefined {
  const path = testAuthPath || getAuthTokenConfigPath();
  if (existsSync(path)) {
    const data = readFileSync(path, "utf8");
    return JSON.parse(data).token;
  }
  return undefined;
}

/**
 * Sets the auth token for the Blink CLI.
 * @param token - The auth token to set.
 * @param testAuthPath - Optional path for testing, overrides default auth path
 */
export function setAuthToken(token: string, testAuthPath?: string) {
  const path = testAuthPath || getAuthTokenConfigPath();
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(
    path,
    JSON.stringify({
      _: "This is your Blink credentials file. DO NOT SHARE THIS FILE WITH ANYONE!",
      token,
    })
  );
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
  const client = new Client();
  let token = getAuthToken();
  if (token) {
    client.authToken = token;

    try {
      // Ensure that the token is valid.
      await client.users.me();
    } catch (_err) {
      // The token is invalid, so we need to login again.
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
 * Opens the browser at the given URL and handles errors.
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const subprocess = await open(url);
    // Catch spawn errors without waiting for the browser to close
    subprocess.once("error", (_err: Error) => {
      console.log(
        chalk.yellow(
          `Could not open the browser. Please visit the URL manually: ${url}`
        )
      );
    });
  } catch (_err) {
    console.log(
      chalk.yellow(
        `Could not open the browser. Please visit the URL manually: ${url}`
      )
    );
  }
}

/**
 * Login makes the CLI output the URL to authenticate with Blink.
 * It returns a valid auth token.
 */
export async function login(): Promise<string> {
  const client = new Client();

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
      await openBrowser(authUrl!);
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
