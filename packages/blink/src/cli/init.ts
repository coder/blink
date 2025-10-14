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
import { templates, type TemplateId } from "./init-templates/index.js";

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
        label: "Scratch",
        value: "scratch",
        hint: "Basic agent with example tool",
      },
      {
        label: "Slack Bot",
        value: "slack-bot",
        hint: "Pre-configured Slack bot",
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

  const runDevCommand = {
    bun: "bun run dev",
    npm: "npm run dev",
    pnpm: "pnpm run dev",
    yarn: "yarn dev",
  }[packageManager];

  log.success(`To get started, run:

${runDevCommand ?? "blink dev"}`);
  outro("Edit agent.ts to hot-reload your agent.");
}
