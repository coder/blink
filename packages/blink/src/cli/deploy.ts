import Client, {
  type AgentDeploymentUploadFile,
  type ListAgentsRequest,
} from "@blink.so/api";
import { stat, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { getHost, loginIfNeeded } from "./lib/auth";
import { writeBlinkConfig } from "./lib/config";
import { migrateDataToBlink } from "./lib/migrate";
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
import { getDevhookID, resetDevhookID } from "./lib/devhook";

export default async function deploy(
  directory?: string,
  options?: { message?: string }
) {
  if (!directory) {
    directory = process.cwd();
  }

  // Detect CI environment
  const isCI = process.env.CI === "true" || !process.stdout.isTTY;

  // Auto-migrate data to .blink if it exists
  await migrateDataToBlink(directory);

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

  // Check for a .blink directory. This stores the agent's deploy config.
  const deployConfigPath = join(rootDirectory, ".blink", "config.json");

  let deployConfig: DeployConfig = {};
  if (existsSync(deployConfigPath)) {
    const deployConfigContent = await readFile(deployConfigPath, "utf-8");
    deployConfig = JSON.parse(deployConfigContent);
  }

  // Environment variables take precedence over config file
  if (process.env.BLINK_ORGANIZATION_ID) {
    deployConfig.organizationId = process.env.BLINK_ORGANIZATION_ID;
  }
  if (process.env.BLINK_AGENT_ID) {
    deployConfig.agentId = process.env.BLINK_AGENT_ID;
  }

  // Select organization
  let organizationName!: string;
  if (deployConfig?.organizationId) {
    try {
      const org = await client.organizations.get(deployConfig.organizationId);
      organizationName = org.name;
    } catch (err) {
      deployConfig.organizationId = undefined;
    }
  }

  if (!deployConfig?.organizationId) {
    const organizations = await client.organizations.list();
    if (organizations.length === 1) {
      deployConfig.organizationId = organizations[0]!.id;
      organizationName = organizations[0]!.name;
    } else if (isCI) {
      throw new Error(
        "Multiple organizations found. To use CI mode, please deploy in interactive mode first to select an organization and generate .blink/config.json"
      );
    } else {
      const selectedId = await select({
        message: "Which organization should contain this agent?",
        options: organizations.map((org) => ({
          value: org.id,
          label: org.name,
        })),
      });
      if (isCancel(selectedId)) {
        return;
      }
      deployConfig.organizationId = selectedId as string;
      organizationName = organizations.find(
        (org) => org.id === selectedId
      )!.name;

      // Add a newline for visual separation.
      console.log();
    }
  }

  let agentName: string | undefined;
  let isNewAgent = false;
  let migratedDevhook = false;

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
      // Agent does not exist. We'll create it with the first deployment.
      isNewAgent = true;
      agentName = packageJSONData.name;
    }
  }

  // Show initial status
  if (isNewAgent) {
    console.log(
      chalk.bold("blink■") +
        " creating agent " +
        organizationName +
        "/" +
        agentName
    );
  } else {
    console.log(
      chalk.bold("blink■") +
        " deploying agent " +
        organizationName +
        "/" +
        agentName
    );
  }

  // Build the agent
  const buildStartTime = Date.now();
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
  const buildDuration = Date.now() - buildStartTime;
  console.log(chalk.gray(`Built ${chalk.dim(`(${buildDuration}ms)`)}`));

  // Collect files to upload
  const outputFiles = await readdir(result.outdir);
  const filesToUpload = Object.fromEntries(
    outputFiles.map((file) => [join(result.outdir, file), file])
  );

  const readmePath = join(directory, "README.md");
  if (await exists(readmePath)) {
    filesToUpload[readmePath] = "README.md";
  }

  const sourceFiles = await collectSourceFiles(rootDirectory);
  const sourceFilesToUpload = Object.fromEntries(
    sourceFiles.map((filePath) => [filePath, relative(rootDirectory, filePath)])
  );

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
    chalk.gray(
      `Uploaded ${totalFiles} ${totalFiles === 1 ? "file" : "files"} ${chalk.dim(`(${formatBytes(totalUploadedBytes)})`)}`
    )
  );
  process.stdout.write("\n");

  // Split uploaded files into output and source
  const allUploadedFiles = uploadedFilesByIndex.filter(
    Boolean
  ) as AgentDeploymentUploadFile[];
  const uploadedFiles = allUploadedFiles.slice(0, outputEntries.length);
  const uploadedSourceFiles = allUploadedFiles.slice(outputEntries.length);

  // Load environment variables
  let prodEnv = await readEnvFile(join(directory, ".env.production"));

  // For new agents, prompt to copy missing env vars from .env.local
  if (isNewAgent) {
    const localEnvFile = join(directory, ".env.local");
    const prodEnvFile = join(directory, ".env.production");
    const localEnv = await readEnvFile(localEnvFile);
    const missingEnvVars = Object.keys(localEnv).filter((key) => !prodEnv[key]);

    if (missingEnvVars.length > 0) {
      if (isCI) {
        console.log(
          chalk.yellow("Warning:") +
            ` Missing ${missingEnvVars.length} var${missingEnvVars.length === 1 ? "" : "s"} in .env.production: ${missingEnvVars.join(", ")}`
        );
        console.log(
          chalk.dim(
            "  Skipping in CI mode. Set these in .env.production if needed."
          )
        );
      } else {
        console.log("\n" + chalk.cyan("Environment Variables"));
        console.log(
          chalk.dim(
            `  Missing ${missingEnvVars.length} var${missingEnvVars.length === 1 ? "" : "s"} in .env.production: ${missingEnvVars.join(", ")}`
          )
        );

        const confirmed = await confirm({
          message: "Copy missing vars from .env.local to .env.production?",
          initialValue: true,
        });
        if (isCancel(confirmed)) {
          return;
        }
        // Add a newline for visual separation.
        console.log();
        if (confirmed) {
          for (const key of missingEnvVars) {
            prodEnv[key] = localEnv[key]!;
          }
          await writeFile(
            prodEnvFile,
            `# Environment variables for production deployment\n${Object.entries(
              prodEnv
            )
              .map(([key, value]) => `${key}=${value}`)
              .join("\n")}`,
            "utf-8"
          );
        }
      }
    }

    // Prompt to migrate devhook to production
    const devhookID = getDevhookID(directory);
    if (devhookID) {
      if (isCI) {
        // Skip devhook migration in CI mode
        console.log(
          chalk.dim("  Skipping webhook tunnel migration in CI mode")
        );
      } else {
        const productionUrl = `https://${devhookID}.blink.host`;
        console.log("\n" + chalk.cyan("Webhook Tunnel"));
        console.log(chalk.dim(`  Current: ${productionUrl} → local dev`));
        console.log(chalk.dim(`  After: ${productionUrl} → production`));
        console.log(
          chalk.dim("  Migrating will keep your webhooks working in production")
        );

        const confirmed = await confirm({
          message: "Migrate tunnel to production?",
        });
        if (isCancel(confirmed)) {
          return;
        }
        // Add a newline for visual separation.
        console.log();
        if (confirmed) {
          migratedDevhook = true;
        }
      }
    }
  }

  const envEntries = Object.entries(prodEnv);

  // Create agent or update env vars
  if (isNewAgent) {
    const devhookID = getDevhookID(directory);
    const agent = await client.agents.create({
      name: packageJSONData.name,
      organization_id: deployConfig.organizationId,
      request_id: migratedDevhook ? devhookID : undefined,
      entrypoint: basename(result.entry),
      output_files: uploadedFiles,
      source_files: uploadedSourceFiles,
      env: envEntries.map(([key, value]) => ({
        key,
        value,
        target: ["production", "preview"] as ("production" | "preview")[],
        secret: true,
      })),
    });
    deployConfig.agentId = agent.id;
    agentName = agent.name;
    const agentUrl = `${getHost()}/${organizationName}/${agentName}`;
    console.log(chalk.gray(`Agent created ${chalk.dim(agentUrl)}`));
  } else if (envEntries.length > 0) {
    // Update environment variables for existing agents
    let updatedCount = 0;
    for (const [key, value] of envEntries) {
      await client.agents.env.create({
        agent_id: deployConfig.agentId!,
        key,
        value,
        target: ["production", "preview"],
        secret: true,
        upsert: true,
      });
      writeInline(
        `${chalk.dim(`[${++updatedCount}/${envEntries.length}]`)} Updating environment variable: ${key} ${chalk.dim("(.env.production)")}`
      );
    }
    writeInline(
      chalk.gray(
        `Updated ${envEntries.length} environment ${envEntries.length === 1 ? "variable" : "variables"} ${chalk.dim("(.env.production)")}`
      )
    );
    process.stdout.write("\n");
  }

  // Warn if local env vars are missing from production
  const localEnv = await readEnvFile(join(directory, ".env.local"));
  const missingEnvVars = Object.keys(localEnv).filter(
    (key) => !Object.keys(prodEnv).includes(key)
  );
  if (missingEnvVars.length > 0) {
    if (isCI) {
      console.log(
        chalk.yellow("Warning:") +
          " The following environment variables are set in .env.local but not in .env.production:"
      );
      for (const v of missingEnvVars) {
        console.log(`- ${v}`);
      }
      console.log(chalk.dim("  Continuing deployment in CI mode"));
    } else {
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
  }

  // Create or fetch deployment
  const deployment = isNewAgent
    ? (
        await client.agents.deployments.list({
          agent_id: deployConfig.agentId!,
        })
      ).items[0]!
    : await client.agents.deployments.create({
        agent_id: deployConfig.agentId!,
        target: "production",
        entrypoint: basename(result.entry),
        output_files: uploadedFiles,
        source_files: uploadedSourceFiles,
        message: options?.message,
      });

  const inspectUrl = `${getHost()}/${organizationName}/${agentName}/deployments/${deployment.number}`;

  // Show deployment URL immediately
  console.log(chalk.gray(`View Deployment ${chalk.dim(inspectUrl)}`));

  // Write deploy config on success
  if (!isCI) {
    await writeBlinkConfig(rootDirectory, deployConfig);
  }

  // Poll for deployment completion
  const s = spinner();
  s.start("Waiting for deployment to be live...");

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = await client.agents.deployments.get({
        agent_id: deployConfig.agentId!,
        deployment_id: deployment.id,
      });

      if (current.status === "success") {
        s.stop();

        if (isNewAgent) {
          console.log("Your agent is live.");
          console.log(chalk.dim(inspectUrl));
        } else {
          console.log("Deployed. All new chats will use this version.");
          console.log(chalk.dim(inspectUrl));
        }

        if (migratedDevhook) {
          resetDevhookID(directory);
          console.log(
            chalk.yellow("Note:") +
              " To continue developing locally with webhooks, you'll need to reconfigure external services (Slack, GitHub, etc.)"
          );

          if (
            // heuristic to check if the user is using Slack
            Object.keys(localEnv).some((key) =>
              key.toLowerCase().includes("slack")
            )
          ) {
            console.log(
              `Run ${chalk.cyan("blink setup slack-app")} to create a new Slack app for development.`
            );
          }
        }
        break;
      }

      if (current.status === "failed") {
        s.stop(
          "Failed" + (current.error_message ? `: ${current.error_message}` : "")
        );
        console.log();
        console.log("Logs: " + chalk.dim(inspectUrl));
        return;
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (err) {
    s.stop("Failed to poll deployment status");
    console.log();
    console.log("Error: " + inspect(err));
    console.log("Logs: " + chalk.dim(inspectUrl));
  }
}

export interface DeployConfig {
  organizationId?: string;
  agentId?: string;
}

// Helpers
const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (err) {
    return false;
  }
};

async function readEnvFile(path: string): Promise<Record<string, string>> {
  return (await exists(path)) ? parse(await readFile(path, "utf-8")) : {};
}

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
    ".blink",
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
