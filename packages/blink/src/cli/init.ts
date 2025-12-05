import { exec, spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  text,
} from "@clack/prompts";
import Handlebars from "handlebars";
import { type TemplateId, templates } from "./init-templates";
import { setupGithubApp } from "./setup-github-app";
import { setupSlackApp } from "./setup-slack-app";

async function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve, _reject) => {
    exec(`${command} --version`, { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}

export function getFilesForTemplate(
  template: TemplateId,
  variables: {
    packageName: string;
    aiProvider: string;
    envLocal: Array<[string, string]>;
  }
): Record<string, string> {
  const templateFiles = templates[template];
  const files: Record<string, string> = {};

  // Register eq helper for Handlebars
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Register helper to check if a key exists in envLocal array
  Handlebars.registerHelper(
    "hasEnvVar",
    (envLocal: Array<[string, string]>, key: string) => {
      return envLocal.some((tuple) => tuple[0] === key);
    }
  );

  // Register helper to check if any of multiple keys exist in envLocal array
  Handlebars.registerHelper(
    "hasAnyEnvVar",
    (envLocal: Array<[string, string]>, ...keys) => {
      // Remove the last argument which is the Handlebars options object
      const keysToCheck = keys.slice(0, -1);
      return keysToCheck.some((key) =>
        envLocal.some((tuple) => tuple[0] === key)
      );
    }
  );

  // Copy all files and render .hbs templates
  for (const [filename, content] of Object.entries(templateFiles)) {
    let outputFilename = filename;
    let outputContent: string = content;

    // Check if this is a Handlebars template
    if (filename.endsWith(".hbs")) {
      // Remove .hbs extension from output filename
      outputFilename = filename.slice(0, -4);

      // Compile and render the template
      const compiledTemplate = Handlebars.compile(content);
      outputContent = compiledTemplate(variables);
    }

    files[outputFilename] = outputContent;
  }

  return files;
}

const packageManagers = [
  { label: "Bun", value: "bun" },
  { label: "NPM", value: "npm" },
  { label: "PNPM", value: "pnpm" },
  { label: "Yarn", value: "yarn" },
] as const;

export async function getAvailablePackageManagers(): Promise<
  (typeof packageManagers)[number][]
> {
  const availabilityChecks = await Promise.all(
    packageManagers.map(async ({ value: pm }) => {
      const available = await isCommandAvailable(pm);
      return { pm, available };
    })
  );
  return packageManagers.filter(
    ({ value: pm }) =>
      availabilityChecks.find(({ pm: pm2 }) => pm2 === pm)?.available
  );
}

export default async function init(directory?: string): Promise<void> {
  if (!directory) {
    directory = process.cwd();
  }

  intro("Initializing a new Blink Agent");

  if ((await readdir(directory)).length > 0) {
    const confirmed = await confirm({
      message: "Directory is not empty. Initialize anyway?",
    });
    if (confirmed === false || isCancel(confirmed)) {
      cancel("Initialization cancelled.");
      process.exit(1);
    }
  }

  const templateChoice = await select({
    options: [
      {
        label: "Scout",
        value: "scout",
        hint: "Full-featured agent with Slack, GitHub, and compute",
      },
      {
        label: "Slack Bot",
        value: "slack-bot",
        hint: "Pre-configured Slack bot",
      },
      {
        label: "Scratch",
        value: "scratch",
        hint: "Basic agent with example tool",
      },
    ],
    message: "Which template do you want to use?",
  });
  if (isCancel(templateChoice)) {
    cancel("Initialization cancelled.");
    process.exit(1);
  }
  const template = templateChoice satisfies TemplateId;

  // spawn the promise in advance to avoid delaying the UI
  const availablePackageManagersPromise = getAvailablePackageManagers();

  const aiProviders = {
    openai: { envVar: "OPENAI_API_KEY", label: "OpenAI" },
    anthropic: { envVar: "ANTHROPIC_API_KEY", label: "Anthropic" },
    vercel: { envVar: "AI_GATEWAY_API_KEY", label: "Vercel AI Gateway" },
  } as const;

  const aiProviderChoice = await select({
    options: [
      {
        label: aiProviders.openai.label,
        value: "openai",
      },
      {
        label: aiProviders.anthropic.label,
        value: "anthropic",
      },
      {
        label: aiProviders.vercel.label,
        value: "vercel",
      },
    ],
    message: "Which AI provider do you want to use?",
  });
  if (isCancel(aiProviderChoice)) {
    cancel("Initialization cancelled.");
    process.exit(1);
  }
  // check that the choice is one of the keys of aiProviders on a type level
  const _check = aiProviderChoice satisfies keyof typeof aiProviders;
  const envVarName = aiProviders[aiProviderChoice].envVar;
  const apiKey = await text({
    message: `Enter your ${aiProviders[aiProviderChoice].label} API key:`,
    placeholder: "Leave empty if you'd like to supply the key yourself later",
  });

  if (isCancel(apiKey)) {
    cancel("Initialization cancelled.");
    process.exit(1);
  }

  const name = basename(directory).replace(/[^a-zA-Z0-9]/g, "-");

  // Autodetect the package manager.
  let packageManager: "bun" | "npm" | "pnpm" | "yarn" | undefined;
  if (process.env.npm_config_user_agent?.includes("bun/")) {
    packageManager = "bun";
  } else if (process.env.npm_config_user_agent?.includes("pnpm/")) {
    packageManager = "pnpm";
  } else if (process.env.npm_config_user_agent?.includes("yarn/")) {
    packageManager = "yarn";
  } else if (process.env.npm_config_user_agent?.includes("npm/")) {
    packageManager = "npm";
  }
  if (!packageManager) {
    const availablePackageManagers = await availablePackageManagersPromise;

    if (availablePackageManagers.length === 0) {
      log.info("Please install dependencies by running:");
      log.info("  npm install");
    } else {
      // Ask the user what to use from available options
      const pm = await select({
        options: availablePackageManagers,
        message: "What package manager do you want to use?",
      });
      if (isCancel(pm)) {
        process.exit(0);
      }
      packageManager = pm;
    }
  }

  if (packageManager) {
    log.info(`Using ${packageManager} as the package manager.`);
  }

  // Build envLocal array with API key if provided
  const envLocal: Array<[string, string]> = [];
  if (apiKey && apiKey.trim() !== "") {
    envLocal.push([envVarName, apiKey]);
  }

  const files = getFilesForTemplate(template, {
    packageName: name,
    aiProvider: aiProviderChoice,
    envLocal,
  });

  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await writeFile(join(directory, path), content);
    })
  );

  if (apiKey && apiKey.trim() !== "") {
    log.success(`API key saved to .env.local`);
  }

  // Log a newline which makes it look a bit nicer.
  console.log("");

  if (packageManager) {
    const child = spawn(packageManager, ["install"], {
      stdio: "inherit",
      cwd: directory,
    });

    await new Promise((resolve, reject) => {
      child.on("close", (code) => {
        if (code === 0) {
          resolve(undefined);
        } else {
        }
      });
      child.on("error", (error) => {
        reject(error);
      });
    });
    // Log a newline which makes it look a bit nicer.
    console.log("");
  }

  let exitProcessManually = false;

  // Set up Slack app if using slack-bot or scout template
  if (template === "slack-bot" || template === "scout") {
    const shouldCreateSlackApp = await confirm({
      message: "Would you like to set up your Slack app now?",
      initialValue: true,
    });

    if (isCancel(shouldCreateSlackApp) || !shouldCreateSlackApp) {
      log.info("You can set up your Slack app later by running:");
      log.info("  blink setup slack-app");
    } else {
      await setupSlackApp(directory, {
        name,
        packageManager,
      });
      // the devhook takes a while to clean up, so we exit the process
      // manually
      exitProcessManually = true;
    }

    console.log("");
  }

  // Set up GitHub app if using scout template
  if (template === "scout") {
    const shouldCreateGithubApp = await confirm({
      message: "Would you like to set up your GitHub App now?",
      initialValue: true,
    });

    if (isCancel(shouldCreateGithubApp) || !shouldCreateGithubApp) {
      log.info("You can set up your GitHub App later by running:");
      log.info("  blink setup github-app");
    } else {
      await setupGithubApp(directory, {
        name,
      });
      exitProcessManually = true;
    }

    console.log("");
  }

  const runDevCommand = {
    bun: "bun run dev",
    npm: "npm run dev",
    pnpm: "pnpm run dev",
    yarn: "yarn dev",
  }[packageManager ?? "npm"];

  log.success(`To get started, run:

${runDevCommand}`);
  outro("Edit agent.ts to hot-reload your agent.");

  if (exitProcessManually) {
    process.exit(0);
  }
}
