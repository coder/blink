import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  confirm,
  intro,
  isCancel,
  log,
  outro,
  spinner,
  text,
} from "@clack/prompts";
import chalk from "chalk";
import type { GitHubAppData } from "../edit/tools/create-github-app";
import { createGithubApp } from "../edit/tools/create-github-app";
import { getHost } from "./lib/auth";
import { createDevhookID, getDevhookID, hasDevhook } from "./lib/devhook";
import { openUrl } from "./lib/util";

export async function updateEnvCredentials(
  envPath: string,
  data: GitHubAppData
): Promise<void> {
  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    // File doesn't exist, that's okay
  }

  // Comment out any existing GitHub App credentials
  envContent = envContent
    .replace(/^(GITHUB_APP_ID=.*)/gm, "# $1")
    .replace(/^(GITHUB_CLIENT_ID=.*)/gm, "# $1")
    .replace(/^(GITHUB_CLIENT_SECRET=.*)/gm, "# $1")
    .replace(/^(GITHUB_WEBHOOK_SECRET=.*)/gm, "# $1")
    .replace(/^(GITHUB_PRIVATE_KEY=.*)/gm, "# $1");

  // Remove trailing newlines then add exactly one
  envContent = `${envContent.trimEnd()}\n`;

  // Append GitHub App credentials
  const credentials = `
# GitHub App credentials
GITHUB_APP_ID=${data.id}
GITHUB_CLIENT_ID=${data.client_id}
GITHUB_CLIENT_SECRET=${data.client_secret}
GITHUB_WEBHOOK_SECRET=${data.webhook_secret}
GITHUB_PRIVATE_KEY="${btoa(data.pem)}"
`;

  await writeFile(envPath, envContent + credentials, "utf-8");
}

export async function setupGithubApp(
  directory: string,
  options?: {
    name?: string;
  }
): Promise<void> {
  const name =
    options?.name || basename(directory).replace(/[^a-zA-Z0-9]/g, "-");

  // Check if .env.local exists
  const envPath = join(directory, ".env.local");
  try {
    await access(envPath);
  } catch {
    log.error(
      "No .env.local file found in this directory. Please run this command from a Blink agent directory."
    );
    outro("GitHub App setup cancelled");
    return;
  }

  const githubAppName = await text({
    message:
      "What should your GitHub App be called? This will be the name displayed on GitHub. You can change it later.",
    placeholder: name,
    defaultValue: name,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "App name cannot be empty";
      }
    },
  });

  if (isCancel(githubAppName)) {
    return;
  }

  const organizationInput = await text({
    message:
      "Enter a GitHub organization name to create the app under, or leave blank for a personal app:",
    placeholder: "Leave blank for personal app",
    defaultValue: "",
  });

  if (isCancel(organizationInput)) {
    return;
  }

  const organization =
    organizationInput && organizationInput.trim().length > 0
      ? organizationInput.trim()
      : undefined;

  // Generate or get devhook ID to get the webhook URL
  const devhookId = hasDevhook(directory)
    ? getDevhookID(directory)
    : createDevhookID(directory);
  if (!devhookId) {
    throw new Error("Failed to obtain devhook ID");
  }
  const webhookUrl = `https://${devhookId}.blink.host`;

  // Create manifest with sensible defaults for a typical GitHub App
  const manifest = {
    name: githubAppName.toString(),
    url: getHost(),
    description: "A Blink agent for GitHub",
    public: false,
    hook_attributes: {
      url: webhookUrl,
      active: true,
    },
    default_events: [
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "push",
    ] as (
      | "issues"
      | "issue_comment"
      | "pull_request"
      | "pull_request_review"
      | "pull_request_review_comment"
      | "push"
    )[],
    default_permissions: {
      contents: "write",
      issues: "write",
      pull_requests: "write",
      metadata: "read",
    } as Record<string, "read" | "write">,
  };

  // Use a promise to capture the callback result
  let resolveApp: (data: GitHubAppData) => void;
  let rejectApp: (err: Error) => void;
  const appPromise = new Promise<GitHubAppData>((resolve, reject) => {
    resolveApp = resolve;
    rejectApp = reject;
  });

  const s = spinner();

  const url = await createGithubApp(
    manifest,
    organization,
    async (err, data) => {
      if (err) {
        rejectApp(err);
        return;
      }
      if (data) {
        resolveApp(data);
      }
    }
  );

  log.info(
    `Please visit this URL to create your GitHub App and return here after finishing:\n\n${chalk.gray(url)}\n`
  );

  const shouldOpen = await confirm({
    message: "Open this URL in your browser automatically?",
    initialValue: true,
  });

  if (isCancel(shouldOpen)) {
    log.warn("Skipping GitHub App setup");
    return;
  }

  if (shouldOpen) {
    await openUrl(
      url,
      "Could not open the browser. Please visit the URL manually."
    );
  }

  s.start("Waiting for GitHub App creation to complete...");

  let appData: GitHubAppData;
  try {
    appData = await appPromise;
  } catch (err) {
    s.stop(
      `Failed to create GitHub App: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  s.stop(chalk.green(`✓ GitHub App "${appData.name}" created!`));

  // Write credentials to .env.local
  await updateEnvCredentials(envPath, appData);
  log.success("Credentials saved to .env.local");

  log.info(
    `\nYour GitHub App is available at: ${chalk.cyan(appData.html_url)}`
  );
  log.info(
    `\nTo install the app on repositories, visit: ${chalk.cyan(`${appData.html_url}/installations/new`)}`
  );

  log.success("GitHub App setup complete!");
}

export default async function setupGithubAppCommand(
  directory?: string
): Promise<void> {
  if (!directory) {
    directory = process.cwd();
  }

  intro("Setting up GitHub App");

  await setupGithubApp(directory);

  process.exit(0);
}
