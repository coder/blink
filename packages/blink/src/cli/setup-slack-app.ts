import crypto from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import util from "node:util";
import Client from "@blink.so/api";
import {
  confirm,
  intro,
  isCancel,
  log,
  outro,
  password,
  spinner,
  text,
} from "@clack/prompts";
import chalk from "chalk";
import { createSlackApp } from "../edit/tools/create-slack-app";
import { getHost, loginIfNeeded } from "./lib/auth";
import { createDevhookID, getDevhookID, hasDevhook } from "./lib/devhook";
import { openUrl } from "./lib/util";

export interface SetupSlackAppDeps {
  /**
   * Authentication function. If not provided, uses the default loginIfNeeded.
   */
  authenticate?: () => Promise<void>;
  /**
   * Get host function. If not provided, uses the default getHost.
   */
  getHost?: () => string | undefined;
  /**
   * API client instance. If not provided, a new client is created.
   */
  client?: Client;
}

export async function verifySlackCredentials(
  botToken: string
): Promise<{ valid: boolean; error?: string; botName?: string }> {
  // Verify bot token with Slack API
  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      user?: string;
    };

    if (!data.ok) {
      return {
        valid: false,
        error: data.error || "Invalid bot token",
      };
    }

    return {
      valid: true,
      botName: data.user,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to verify credentials: ${error}`,
    };
  }
}

export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const time = Math.floor(Date.now() / 1000);
  const requestTimestamp = parseInt(timestamp, 10);

  // Request is older than 5 minutes
  if (Math.abs(time - requestTimestamp) > 60 * 5) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", signingSecret);
  const sigBasestring = `v0:${timestamp}:${body}`;
  hmac.update(sigBasestring);
  const mySignature = `v0=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

const makeDisposable = (value: unknown): Disposable => {
  if (!(typeof value === "object" && value !== null)) {
    throw new Error("Unable to make value disposable, it's not an object");
  }
  if (Symbol.dispose in value) {
    // the input already is a disposable value
    return value as Disposable;
  }
  if ("dispose" in value && typeof value.dispose === "function") {
    const obj = value as object & { dispose: () => void };
    (obj as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose] = () =>
      obj.dispose();
    return obj as unknown as Disposable;
  }
  throw new Error("Unable to make value disposable");
};

export async function updateEnvCredentials(
  envPath: string,
  botToken?: string,
  signingSecret?: string
): Promise<void> {
  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    // File doesn't exist, that's okay
  }

  // Comment out any existing Slack credentials
  envContent = envContent
    .replace(/^(SLACK_BOT_TOKEN=.*)/gm, "# $1")
    .replace(/^(SLACK_SIGNING_SECRET=.*)/gm, "# $1");

  // Remove trailing newlines then add exactly one
  envContent = `${envContent.trimEnd()}\n`;

  // Append Slack credentials
  const credentials: string[] = [];
  credentials.push("");
  credentials.push("# Slack App credentials");
  if (botToken) {
    credentials.push(`SLACK_BOT_TOKEN=${botToken}`);
  }
  if (signingSecret) {
    credentials.push(`SLACK_SIGNING_SECRET=${signingSecret}`);
  }
  credentials.push("");

  await writeFile(envPath, envContent + credentials.join("\n"), "utf-8");
}

async function determinePackageManager(
  directory: string
): Promise<"bun" | "npm" | "pnpm" | "yarn"> {
  const filesInDirectory = await readdir(directory);
  const mapping = [
    ["bun", "bun.lock"],
    ["npm", "package-lock.json"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
  ] as const;
  for (const [packageManager, lockfile] of mapping) {
    for (const file of filesInDirectory) {
      if (file.includes(lockfile)) {
        return packageManager;
      }
    }
  }
  return "npm";
}

export async function setupSlackApp(
  directory: string,
  options?: {
    name?: string;
    packageManager?: "bun" | "npm" | "pnpm" | "yarn";
    _deps?: SetupSlackAppDeps;
  }
): Promise<void> {
  const authenticate = options?._deps?.authenticate ?? loginIfNeeded;
  const getHostFn = options?._deps?.getHost ?? getHost;
  await authenticate();

  const name =
    options?.name || basename(directory).replace(/[^a-zA-Z0-9]/g, "-");
  const packageManager =
    options?.packageManager || (await determinePackageManager(directory));

  // Check if .env.local exists
  const envPath = join(directory, ".env.local");
  try {
    await access(envPath);
  } catch {
    log.error(
      "No .env.local file found in this directory. Please run this command from a Blink agent directory."
    );
    outro("Slack app setup cancelled");
    return;
  }

  const slackAppName = await text({
    message:
      "What should your Slack app be called? This will be the name displayed in Slack. You can change it later.",
    placeholder: name,
    defaultValue: name,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "App name cannot be empty";
      }
    },
  });

  if (isCancel(slackAppName)) {
    return;
  }

  // Generate or get devhook ID to get the webhook URL
  const devhookId = hasDevhook(directory)
    ? getDevhookID(directory)
    : createDevhookID(directory);
  const webhookUrl = `https://${devhookId}.blink.host`;
  if (!devhookId) {
    throw new Error("Failed to obtain devhook ID");
  }

  log.info("Starting webhook listener...");

  // State for handling Slack events
  let signingSecret = "";
  let botToken = "";
  let dmReceived = false;
  let dmChannel = "";
  let dmTimestamp = "";
  let signatureFailureDetected = false;
  let lastFailedChannel: string | undefined;

  const host = getHostFn();
  if (!host) {
    throw new Error(
      "No Blink host configured. Set the BLINK_HOST environment variable or run `blink login <host>`."
    );
  }
  const client =
    options?._deps?.client ??
    new Client({
      baseURL: host,
    });

  let resolveConnected = () => {};
  let rejectConnected = (_error: unknown) => {};
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  const listener = client.devhook.listen({
    id: devhookId,
    onRequest: async (request) => {
      const body = await request.text();
      let payload: {
        type?: string;
        challenge?: string;
        event?: {
          type?: string;
          channel_type?: string;
          bot_id?: string;
          channel?: string;
          ts?: string;
        };
      };

      try {
        payload = JSON.parse(body);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      // Handle URL verification challenge
      if (payload.type === "url_verification") {
        log.info("✓ Webhook challenge received");
        return new Response(JSON.stringify({ challenge: payload.challenge }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify signature if we have a signing secret
      if (signingSecret) {
        const signature = request.headers.get("x-slack-signature");
        const timestamp = request.headers.get("x-slack-request-timestamp");

        if (!signature || !timestamp) {
          return new Response("Missing signature", { status: 401 });
        }

        if (!verifySlackSignature(signingSecret, timestamp, body, signature)) {
          signatureFailureDetected = true;

          // Try to capture the channel from the failed request for messaging
          if (
            payload.event?.type === "message" &&
            payload.event.channel_type === "im" &&
            !payload.event.bot_id
          ) {
            lastFailedChannel = payload.event.channel;
          }

          return new Response("Invalid signature", { status: 401 });
        }
      }

      // Handle DM event
      if (
        payload.event?.type === "message" &&
        payload.event.channel_type === "im" &&
        !payload.event.bot_id
      ) {
        dmReceived = true;
        dmChannel = payload.event.channel ?? "";
        dmTimestamp = payload.event.ts ?? "";
      }

      return new Response("OK");
    },
    onConnect: () => {
      resolveConnected();
    },
    onDisconnect: () => {
      // Silent disconnection
    },
    onError: (error) => {
      rejectConnected(error);
    },
  });
  // at the time of writing, the listener has a `dispose` method, so
  // we convert it to a Disposable value to leverage the `using` statement
  using _listener = makeDisposable(listener);

  // Create manifest with sensible defaults
  const manifest = {
    display_information: {
      name: slackAppName.toString(),
      description: "A Blink agent for Slack",
      background_color: "#4A154B",
    },
    features: {
      bot_user: {
        display_name: slackAppName.toString(),
        always_online: true,
      },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      assistant_view: {
        assistant_description: "A helpful assistant powered by Blink",
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "assistant:write",
          "reactions:write",
          "reactions:read",
          "channels:history",
          "chat:write",
          "groups:history",
          "groups:read",
          "files:read",
          "im:history",
          "im:read",
          "im:write",
          "mpim:history",
          "mpim:read",
          "users:read",
          "links:read",
          "commands",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: webhookUrl,
        bot_events: [
          "app_mention",
          "message.channels",
          "message.groups",
          "message.im",
          "reaction_added",
          "reaction_removed",
          "assistant_thread_started",
          "member_joined_channel",
        ],
      },
      interactivity: {
        is_enabled: true,
        request_url: webhookUrl,
      },
      token_rotation_enabled: false,
      org_deploy_enabled: false,
      socket_mode_enabled: false,
    },
  } satisfies Parameters<typeof createSlackApp>[0];

  const slackAppUrl = createSlackApp(manifest);

  log.info(
    `Please visit this URL to create your Slack app and return here after finishing:\n\n${chalk.gray(slackAppUrl)}\n`
  );

  const shouldOpen = await confirm({
    message: "Open this URL in your browser automatically?",
    initialValue: true,
  });

  if (isCancel(shouldOpen)) {
    log.warn("Skipping Slack app setup");
    return;
  }

  if (shouldOpen) {
    await openUrl(
      slackAppUrl,
      "Could not open the browser. Please visit the URL manually."
    );
  }

  // Ask for app ID
  const appId = await text({
    message: `After creating the app, paste the App ID from the "Basic Information" page:`,
    placeholder: "A01234567AB",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "App ID is required";
      }
    },
  });

  if (isCancel(appId)) {
    log.warn("Skipping Slack app setup");
    return;
  }

  // Ask for signing secret with direct link
  signingSecret = (await password({
    message: `Paste your Signing Secret from the same page:`,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Signing secret is required";
      }
    },
  })) as string;

  if (isCancel(signingSecret)) {
    log.warn("Skipping Slack app setup");
    return;
  }

  // Ask for bot token with validation loop
  let tokenValid = false;
  while (!tokenValid) {
    botToken = (await password({
      message: `Install your app and paste your Bot Token from ${chalk.cyan(`https://api.slack.com/apps/${appId}/install-on-team`)}`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Bot token is required";
        }
      },
    })) as string;

    if (isCancel(botToken)) {
      log.warn("Skipping Slack app setup");
      return;
    }

    const s = spinner();
    s.start("Verifying bot token...");

    const verification = await verifySlackCredentials(botToken);

    if (verification.valid) {
      s.stop(`✓ Bot token verified!`);
      tokenValid = true;
    } else {
      s.stop(`✗ Failed to verify bot token: ${verification.error}`);

      const retry = await confirm({
        message: "Would you like to try again?",
        initialValue: true,
      });

      if (isCancel(retry) || !retry) {
        log.warn("Skipping Slack app setup");
        return;
      }
    }
  }

  // Write credentials to .env.local
  await updateEnvCredentials(envPath, botToken, signingSecret);
  log.success("Credentials saved to .env.local");

  await connected;

  // Wait for DM
  const s = spinner();

  s.start(
    `Try sending a DM to the bot on Slack - it's ${chalk.bold(chalk.cyan(slackAppName))} in the search bar.`
  );

  const runDevCommand = {
    bun: "bun run dev",
    npm: "npm run dev",
    pnpm: "pnpm run dev",
    yarn: "yarn dev",
  }[packageManager];

  // Poll for DM
  while (!dmReceived) {
    // Check for signature verification failures
    if (signatureFailureDetected) {
      s.stop("✗ Invalid signing secret detected");

      // Try to send a message to Slack informing the user
      if (lastFailedChannel && botToken) {
        try {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: lastFailedChannel,
              text: `⚠️ There seems to be a problem with the signing secret. Please check the CLI for instructions on how to fix it.`,
            }),
          });
        } catch {
          // Silent fail - user will see the CLI prompt
        }
      }

      // Prompt user to re-enter the signing secret
      const newSigningSecret = await password({
        message: `The signing secret appears to be incorrect. Please paste the correct Signing Secret from ${chalk.cyan(`https://api.slack.com/apps/${appId}/general`)}`,
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Signing secret is required";
          }
        },
      });

      if (isCancel(newSigningSecret)) {
        log.warn("Skipping Slack app setup");
        return;
      }

      signingSecret = newSigningSecret;
      signatureFailureDetected = false;
      lastFailedChannel = undefined;

      // Update the signing secret in .env.local
      await updateEnvCredentials(envPath, undefined, signingSecret);

      s.start("Please try sending a DM to the bot again on Slack...");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  s.stop(chalk.green("✓ DM received!"));

  // Send success message back to Slack
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: dmChannel,
        thread_ts: dmTimestamp,
        text: `Congrats, your app is now installed and ready to use! Run \`${runDevCommand}\` to use your agent.`,
      }),
    });
  } catch (error) {
    log.warn(`Could not send message to Slack: ${util.inspect(error)}`);
  }

  log.success("Slack app setup complete!");
}

export default async function setupSlackAppCommand(
  directory?: string
): Promise<void> {
  if (!directory) {
    directory = process.cwd();
  }

  intro("Setting up Slack app");

  await setupSlackApp(directory);

  // the devhook takes a while to clean up, so we exit the process
  // manually
  process.exit(0);
}
