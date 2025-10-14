import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
} from "@clack/prompts";
import { spawn } from "child_process";
import { readdir, writeFile } from "fs/promises";
import { basename, join } from "path";
import { templates, type TemplateId } from "./init-templates";
import { setupSlackApp } from "./setup-slack-app";

function getFilesForTemplate(
  template: TemplateId,
  name: string
): Record<string, string> {
  const templateFiles = templates[template];
  const files: Record<string, string> = {};

  // Copy all files and replace {{name}} placeholder
  for (const [filename, content] of Object.entries(templateFiles)) {
    files[filename] = content.replace(/\{\{name\}\}/g, name);
  }

  return files;
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
    // Ask the user what to use.
    const pm = await select({
      options: [
        {
          label: "Bun",
          value: "bun",
        },
        {
          label: "NPM",
          value: "npm",
        },
        {
          label: "PNPM",
          value: "pnpm",
        },
        {
          label: "Yarn",
          value: "yarn",
        },
      ],
      message: "What package manager do you want to use?",
    });
    if (isCancel(pm)) {
      process.exit(0);
    }
    packageManager = pm;
  }

  log.info(`Using ${packageManager} as the package manager.`);

  const files = getFilesForTemplate(template, name);

  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await writeFile(join(directory, path), content);
    })
  );

  // Log a newline which makes it look a bit nicer.
  console.log("");

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

  let exitProcessManually = false;

  // Set up Slack app if using slack-bot template
  if (template === "slack-bot") {
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

  const runDevCommand = {
    bun: "bun run dev",
    npm: "npm run dev",
    pnpm: "pnpm run dev",
    yarn: "yarn dev",
  }[packageManager];

  log.success(`To get started, run:

${runDevCommand ?? "blink dev"}`);
  outro("Edit agent.ts to hot-reload your agent.");

  if (exitProcessManually) {
    process.exit(0);
  }
}
