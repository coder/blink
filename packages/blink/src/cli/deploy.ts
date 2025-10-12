import Client, {
  type AgentDeploymentUploadFile,
  type ListAgentsRequest,
} from "@blink.so/api";
import { stat, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { loginIfNeeded } from "./lib/auth";
import { migrateBlinkToData } from "./lib/migrate";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir } from "fs/promises";
import { select, confirm, isCancel, spinner } from "@clack/prompts";
import { parse } from "dotenv";
import chalk from "chalk";
import { findNearestEntry } from "../build/util";
import { resolveConfig, type BuildResult } from "../build";
import { version } from "../../package.json";
import ignore from "ignore";
import { inspect } from "node:util";

export default async function deploy(
  directory?: string,
  options?: { message?: string }
) {
  if (!directory) {
    directory = process.cwd();
  }

  // Auto-migrate .blink to data if it exists
  await migrateBlinkToData(directory);

  const token = await loginIfNeeded();
  const client = new Client({
    authToken: token,
    // @ts-ignore - This is just because of Bun.
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-blink-cli-version", version);
      return fetch(url, {
        ...init,
        headers,
      });
    },
  });

  // Check for the deploy file first.
  const packageJSON = await findNearestEntry(directory, "package.json");
  if (!packageJSON) {
    throw new Error("package.json not found");
  }
  const packageJSONContent = await readFile(packageJSON, "utf-8");
  const packageJSONData = JSON.parse(packageJSONContent);

  // Find the nearest config file if it exists.
  const rootDirectory = dirname(packageJSON);

  // Check for a data directory. This stores the agent's deploy config.
  const deployConfigPath = join(rootDirectory, "data", "config.json");

  let deployConfig: DeployConfig = {};
  if (existsSync(deployConfigPath)) {
    const deployConfigContent = await readFile(deployConfigPath, "utf-8");
    deployConfig = JSON.parse(deployConfigContent);
  }

  let organizationName!: string;
  // Attempt to get the organization that is associated with the agent.
  // If the user only has a single organization, we will use that.
  if (deployConfig?.organizationId) {
    try {
      // Just ensure the user has access to the organization.
      const org = await client.organizations.get(deployConfig.organizationId);
      organizationName = org.name;
    } catch (err) {
      deployConfig.organizationId = undefined;
    }
  }

  if (!deployConfig?.organizationId) {
    const organizations = await client.organizations.list();
    if (organizations.length === 1) {
      const organization = organizations[0]!;
      deployConfig.organizationId = organization.id;
      organizationName = organization.name;
    } else {
      // Prompt the user to select an organization.
      const organization = await select({
        message: "Which organization should contain this agent?",
        options: organizations.map((organization) => ({
          value: organization.id,
          label: organization.name,
        })),
      });
      if (isCancel(organization)) {
        return;
      }
      deployConfig.organizationId = organization;
      organizationName = organizations.find(
        (org) => org.id === organization
      )!.name!;
    }
  }

  if (!deployConfig.organizationId) {
    throw new Error("Developer error: No organization ID found.");
  }

  let agentName: string | undefined;

  if (deployConfig?.agentId) {
    // Ensure the user has access to the agent.
    try {
      const agent = await client.agents.get(deployConfig.agentId);
      agentName = agent.name;
    } catch (err) {
      deployConfig.agentId = undefined;
    }
  }

  if (!deployConfig?.agentId) {
    // Check if the agent exists with the same package name.
    try {
      const agent = await client.organizations.agents.get({
        organization_id: deployConfig.organizationId,
        agent_name: packageJSONData.name,
      });
      deployConfig.agentId = agent.id;
      agentName = agent.name;
    } catch (err) {
      // Agent does not exist. We'll need to create it as
      // part of this deploy.
      const agent = await client.agents.create({
        name: packageJSONData.name,
        organization_id: deployConfig.organizationId,
      });
      deployConfig.agentId = agent.id;
      agentName = agent.name;
    }
  }

  if (!deployConfig.agentId) {
    throw new Error("Developer error: No agent ID found.");
  }

  // At this point, we should write the deploy config to the data directory.
  // Make the directory if it doesn't exist.
  await mkdir(dirname(deployConfigPath), {
    recursive: true,
  });
  await writeFile(
    deployConfigPath,
    JSON.stringify(
      {
        _: "This file can be source controlled. It contains no secrets.",
        ...deployConfig,
      },
      null,
      2
    ),
    "utf-8"
  );

  // Upload the agent to the Blink Cloud.
  const config = resolveConfig(rootDirectory);
  const result = await new Promise<BuildResult>((resolve, reject) => {
    config
      .build({
        cwd: rootDirectory,
        entry: config.entry,
        outdir: config.outdir,
        watch: false,
        onStart: () => {},
        onResult: (r) => {
          resolve(r);
        },
      })
      .catch(reject);
  });
  if (!result) {
    throw new Error("Failed to build agent");
  }
  if ("error" in result) {
    throw new Error(result.error.message);
  }

  // Files to upload is a record of absolute path to upload path.
  // e.g. "/home/kyle/agent/agent.js" -> "agent.js"
  const filesToUpload: Record<string, string> = {};

  const outputFiles = await readdir(result.outdir);
  for (const file of outputFiles) {
    filesToUpload[join(result.outdir, file)] = file;
  }

  // Check if a README.md exists in the root directory.
  // If it does, we upload it as well.
  const readmePath = join(directory, "README.md");
  if (await exists(readmePath)) {
    filesToUpload[readmePath] = "README.md";
  }

  // Collect source files
  const sourceFilesToUpload: Record<string, string> = {};
  const sourceFiles = await collectSourceFiles(rootDirectory);
  for (const filePath of sourceFiles) {
    const relativePath = relative(rootDirectory, filePath);
    sourceFilesToUpload[filePath] = relativePath;
  }

  // Combine all files to upload in one batch
  const outputEntries = Object.entries(filesToUpload);
  const sourceEntries = Object.entries(sourceFilesToUpload);
  const allEntries = [...outputEntries, ...sourceEntries];
  const totalFiles = allEntries.length;
  let startedCount = 0;
  let uploadedCount = 0;
  let totalUploadedBytes = 0;
  const uploadedFilesByIndex: (AgentDeploymentUploadFile | undefined)[] =
    new Array(totalFiles);

  // Upload all files with unified progress
  await mapWithConcurrency(
    allEntries,
    10,
    async ([filePath, uploadPath], index) => {
      const st = await stat(filePath);
      const fileSize = st.size;
      const startNumber = ++startedCount;
      writeInline(
        `${chalk.dim(`[${startNumber}/${totalFiles}]`)} Uploading ${uploadPath} (${formatBytes(
          fileSize
        )})...`
      );
      const fileContent = await readFile(filePath);
      const uploadedFile = await client.files.upload(
        new File([Buffer.from(fileContent)], uploadPath)
      );
      uploadedFilesByIndex[index] = {
        path: uploadPath,
        id: uploadedFile.id,
      };
      uploadedCount += 1;
      totalUploadedBytes += fileSize;
    }
  );

  writeInline(
    `${chalk.dim(`[${uploadedCount}/${totalFiles}]`)} Uploaded files (${formatBytes(
      totalUploadedBytes
    )}).`
  );
  process.stdout.write("\n");

  // Split uploaded files into output and source
  const allUploadedFiles = uploadedFilesByIndex.filter(
    Boolean
  ) as AgentDeploymentUploadFile[];
  const uploadedFiles = allUploadedFiles.slice(0, outputEntries.length);
  const uploadedSourceFiles = allUploadedFiles.slice(outputEntries.length);

  // Update environment variables.
  // If there are env vars in .env.local that are not in .env.production,
  // we should fetch env vars from the cloud - and then let the user
  // confirm that their secrets are set.
  const localEnvFile = join(directory, ".env.local");
  let localEnvVarsSet: string[] = [];
  if (await exists(localEnvFile)) {
    const localEnv = parse(await readFile(localEnvFile, "utf-8"));
    localEnvVarsSet = Object.keys(localEnv);
  }

  let cloudEnvVarsSet: string[] = [];
  const cloudEnvVars = await client.agents.env.list({
    agent_id: deployConfig.agentId,
  });
  cloudEnvVarsSet = cloudEnvVars.map((env) => env.key);

  const prodEnvFile = join(directory, ".env.production");
  if (await exists(prodEnvFile)) {
    // Upsert all of these env vars into the cloud.
    const prodEnv = parse(await readFile(prodEnvFile, "utf-8"));
    const envEntries = Object.entries(prodEnv);
    const totalEnvVars = envEntries.length;
    let updatedCount = 0;
    for (const [key, value] of envEntries) {
      const created = await client.agents.env.create({
        agent_id: deployConfig.agentId,
        key: key,
        value: value,
        target: ["production", "preview"],
        secret: true,
        upsert: true,
      });
      cloudEnvVarsSet.push(created.key);
      updatedCount += 1;
      writeInline(
        `${chalk.dim(`[${updatedCount}/${totalEnvVars}]`)} Updating environment variable: ${key} ${chalk.dim("(.env.production)")}`
      );
    }
    writeInline(
      `${chalk.dim(`[${updatedCount}/${totalEnvVars}]`)} Updated environment variables! ${chalk.dim("(.env.production)")}`
    );
    process.stdout.write("\n");
  }

  // If there are local env vars that are not in cloud env vars,
  // we should warn the user that they might have missed something.
  const missingEnvVars = localEnvVarsSet.filter(
    (v) => !cloudEnvVarsSet.includes(v)
  );
  if (missingEnvVars.length > 0) {
    console.log(
      "Warning: The following environment variables are set in .env.local but not in .env.production:"
    );
    for (const v of missingEnvVars) {
      console.log(`- ${v}`);
    }
    const confirmed = await confirm({
      message: "Do you want to deploy anyway?",
    });
    if (confirmed === false || isCancel(confirmed)) {
      return;
    }
  }

  // Create deployment
  const deployment = await client.agents.deployments.create({
    agent_id: deployConfig.agentId,
    target: "production",
    entrypoint: basename(result.entry),
    output_files: uploadedFiles,
    source_files: uploadedSourceFiles,
    message: options?.message,
  });

  const inspectUrl = `https://blink.so/${organizationName}/${agentName}/deployments/${deployment.number}`;
  console.log(`Deployed:`, inspectUrl);

  const s = spinner();
  s.start("Waiting for deployment to be live...");

  // Poll until the deployment completes or fails
  try {
    const pollIntervalMs = 500;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = await client.agents.deployments.get({
        agent_id: deployConfig.agentId,
        deployment_id: deployment.id,
      });
      if (current.status === "success") {
        let msg = "Deployment successful.";
        if (current.target === "production") {
          msg += " All chats will use this deployment!";
        }
        s.stop(msg);

        // Check if the agent has request capability and output the request URL
        const agentDetails = await client.agents.get(deployConfig.agentId);
        if (agentDetails.request_url) {
          console.log(
            `\nSend webhooks from anywhere: ${agentDetails.request_url}`
          );
        }

        break;
      }
      if (current.status === "failed") {
        let msg = "Deployment failed.";
        if (current.error_message) {
          msg += ` ${current.error_message}`;
        }
        s.stop(msg);
        console.log("Read logs for details:", inspectUrl);
        return;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  } catch (err) {
    // If polling fails, still point the user to inspect page
    s.stop("Failed to poll for deployment status: " + inspect(err));
    console.log("Read logs for details:", inspectUrl);
    return;
  }
}

export interface DeployConfig {
  organizationId?: string;
  agentId?: string;
}

const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (err) {
    return false;
  }
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= items.length) break;
        results[currentIndex] = await mapper(
          items[currentIndex]!,
          currentIndex
        );
      }
    });
  await Promise.all(workers);
  return results;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)}${sizes[i]}`;
}

function writeInline(message: string) {
  if (process.stdout.isTTY) {
    try {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(message);
      return;
    } catch {}
  }
  console.log(message);
}

async function collectSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  // Default patterns to ignore
  const defaultIgnorePatterns = [
    ".git",
    "node_modules",
    "data",
    ".env",
    ".env.*",
  ];

  const ig = ignore().add(defaultIgnorePatterns);

  // Read .gitignore if it exists
  const gitignorePath = join(rootDir, ".gitignore");
  if (await exists(gitignorePath)) {
    const gitignoreContent = await readFile(gitignorePath, "utf-8");
    ig.add(gitignoreContent);
  }

  async function walkDir(dir: string, baseDir: string = rootDir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);

      // Check if this path should be ignored
      if (ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walkDir(fullPath, baseDir);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walkDir(rootDir);
  return files;
}
