/** biome-ignore-all lint/suspicious/noConsole: CLI output */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import Client, { type Agent } from "@blink.so/api";
import * as clack from "@clack/prompts";
import { Semaphore } from "async-mutex";
import chalk from "chalk";
import { version } from "../../package.json";
import { getHost, loginIfNeeded } from "./lib/auth";
import { writeBlinkConfig } from "./lib/config";

/**
 * Dependencies that can be injected for testing.
 */
export interface PullDeps {
  /**
   * API client instance. If not provided, a new client is created after auth.
   */
  client?: Client;

  /**
   * Authentication function. If not provided, uses the default loginIfNeeded.
   * Return the auth token.
   */
  authenticate?: () => Promise<string>;

  /**
   * Get host function. If not provided, uses the default getHost.
   */
  getHost?: () => string | undefined;
}

export interface PullOptions {
  dir?: string;
  /** Test dependencies - only used in tests */
  _deps?: PullDeps;
}

/**
 * Pull an agent's source code to a local directory.
 * @returns 0 on success, 1 on error/cancellation
 */
export default async function pull(
  agent?: string,
  options?: PullOptions
): Promise<number> {
  const deps = options?._deps;

  // Clack prompts
  const { intro, cancel, confirm, select, spinner, log, isCancel } = clack;

  // Authenticate first (needed for both modes)
  const authenticate = deps?.authenticate ?? loginIfNeeded;
  const getHostFn = deps?.getHost ?? getHost;
  const token = await authenticate();
  // Host is guaranteed to be set after authenticate (loginIfNeeded)
  const host = getHostFn();
  if (!host) {
    throw new Error("No Blink host configured");
  }

  const client =
    deps?.client ??
    new Client({
      baseURL: host,
      authToken: token,
      // @ts-expect-error - This is just because of Bun.
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-blink-cli-version", version);
        return fetch(url, { ...init, headers });
      },
    });

  let orgId: string;
  let orgName: string;
  let agentId: string;
  let agentName: string;

  // Determine target directory
  const targetDir = resolve(options?.dir || process.cwd());

  intro(`Pulling a Blink Agent into ${chalk.bold(targetDir)}`);

  if (agent) {
    // Direct mode: parse org-name/agent-name
    const parts = agent.split("/");
    if (parts.length !== 2) {
      throw new Error("Agent must be in format: org-name/agent-name");
    }
    [orgName, agentName] = parts as [string, string];

    const s = spinner();
    s.start(`Finding ${orgName}/${agentName}...`);

    const orgs = await client.organizations.list();
    const org = orgs.find((o) => o.name === orgName);
    if (!org) {
      s.stop(`Organization "${orgName}" not found`);
      return 1;
    }
    orgId = org.id;

    let fetchedAgent: Agent;
    try {
      fetchedAgent = await client.organizations.agents.get({
        organization_id: orgId,
        agent_name: agentName,
      });
    } catch {
      s.stop(`Agent "${agentName}" not found in organization "${orgName}"`);
      return 1;
    }
    agentId = fetchedAgent.id;
    s.stop(`Found ${orgName}/${agentName}`);
  } else {
    // Interactive mode: select org and agent
    const orgs = await client.organizations.list();

    if (orgs.length === 0) {
      throw new Error("You don't have access to any organizations");
    }

    if (orgs.length === 1) {
      const firstOrg = orgs[0] as NonNullable<typeof orgs>[0];
      orgId = firstOrg.id;
      orgName = firstOrg.name;
      log.info(`Using organization: ${chalk.bold(orgName)}`);
    } else {
      const selectedOrgId = await select({
        message: "Select an organization:",
        options: orgs.map((org) => ({ value: org.id, label: org.name })),
      });
      if (isCancel(selectedOrgId)) return 1;
      orgId = selectedOrgId as string;
      const selectedOrg = orgs.find((o) => o.id === orgId);
      orgName = selectedOrg?.name ?? "";
    }

    // List agents in org
    const agentsResponse = await client.agents.list({ organization_id: orgId });
    const agents = agentsResponse.items;

    if (agents.length === 0) {
      throw new Error(`No agents found in organization "${orgName}"`);
    }

    if (agents.length === 1) {
      const firstAgent = agents[0] as NonNullable<typeof agents>[0];
      const confirmed = await confirm({
        message: `Pull agent ${chalk.bold(firstAgent.name)}?`,
      });
      if (confirmed === false || isCancel(confirmed)) {
        cancel("Pull cancelled.");
        return 1;
      }
      agentId = firstAgent.id;
      agentName = firstAgent.name;
    } else {
      const selectedAgentId = await select({
        message: "Select an agent to pull:",
        options: agents.map((a) => ({ value: a.id, label: a.name })),
      });
      if (isCancel(selectedAgentId)) return 1;
      agentId = selectedAgentId as string;
      const selectedAgent = agents.find((a) => a.id === agentId);
      agentName = selectedAgent?.name ?? "";
    }
  }

  // Check if directory is non-empty
  if (existsSync(targetDir)) {
    if ((await readdir(targetDir)).length > 0) {
      const confirmed = await confirm({
        message: `Directory ${chalk.bold(targetDir)} is not empty. Pull anyway?`,
      });
      if (confirmed === false || isCancel(confirmed)) {
        cancel("Pull cancelled.");
        return 1;
      }
    }
  } else {
    await mkdir(targetDir, { recursive: true });
  }

  // Get agent to check active deployment
  const agentData = await client.agents.get(agentId);
  if (!agentData.active_deployment_id) {
    throw new Error("Agent has no active deployment");
  }

  // Get deployment with source files
  const deployment = await client.agents.deployments.get({
    agent_id: agentId,
    deployment_id: agentData.active_deployment_id,
  });

  if (!deployment.source_files || deployment.source_files.length === 0) {
    throw new Error("No source files found in active deployment");
  }

  // Download and write files in parallel with progress
  const totalFiles = deployment.source_files.length;
  let completedCount = 0;

  const downloadSpinner = spinner();
  const updateProgress = () => {
    downloadSpinner.message(
      `Downloading ${chalk.dim(`(${completedCount}/${totalFiles})`)}`
    );
  };

  downloadSpinner.start(`Downloading ${chalk.dim(`(0/${totalFiles})`)}`);

  const semaphore = new Semaphore(30);

  await Promise.all(
    deployment.source_files.map(async (file) => {
      await semaphore.runExclusive(async () => {
        const fileData = await client.files.get(file.id);
        const content = await fileData.text();
        const filePath = join(targetDir, file.path);

        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");

        completedCount++;
        updateProgress();
      });
    })
  );

  downloadSpinner.stop(`Downloaded ${totalFiles} files`);

  // Create .blink/config.json
  await writeBlinkConfig(targetDir, {
    organizationId: orgId,
    agentId: agentId,
  });

  // Detect package manager from lock files
  const downloadedPaths = deployment.source_files.map((f) => f.path);
  const packageManager = detectPackageManager(downloadedPaths);
  const installCmd = {
    bun: "bun install",
    npm: "npm install",
    pnpm: "pnpm install",
    yarn: "yarn install",
  }[packageManager];
  const devCmd = {
    bun: "bun run dev",
    npm: "npm run dev",
    pnpm: "pnpm run dev",
    yarn: "yarn dev",
  }[packageManager];

  log.success(
    `Pulled ${chalk.bold(`${orgName}/${agentName}`)} to ${chalk.dim(targetDir)}`
  );

  log.info(`Next steps:

  1. Install dependencies:
     ${chalk.cyan(installCmd)}

  2. Add environment variables:
     ${chalk.dim(".env.local")} - for local development
     ${chalk.dim(".env.production")} - for production deployment

  3. Set up integrations for local development:
     ${chalk.cyan("blink setup slack-app")}
     ${chalk.cyan("blink setup github-app")}

  4. Start the development server:
     ${chalk.cyan(devCmd)}

  5. Deploy your agent:
     ${chalk.cyan("blink deploy")}`);

  return 0;
}

function detectPackageManager(
  filePaths: string[]
): "bun" | "npm" | "pnpm" | "yarn" {
  if (filePaths.includes("bun.lockb") || filePaths.includes("bun.lock"))
    return "bun";
  if (filePaths.includes("pnpm-lock.yaml")) return "pnpm";
  if (filePaths.includes("yarn.lock")) return "yarn";
  return "npm";
}
