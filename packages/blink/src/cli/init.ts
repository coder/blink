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
import { spawn } from "child_process";
import { readdir, readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import Handlebars from "handlebars";
import { templates, type TemplateId } from "./init-templates";
import { setupSlackApp } from "./setup-slack-app";

function getFilesForTemplate(
  template: TemplateId,
  variables: {
    packageName: string;
    aiProvider: string;
  }
): Record<string, string> {
  const templateFiles = templates[template];
  const files: Record<string, string> = {};

  // Register eq helper for Handlebars
  Handlebars.registerHelper("eq", (a, b) => a === b);

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

  const files = getFilesForTemplate(template, {
    packageName: name,
    aiProvider: aiProviderChoice,
  });

  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await writeFile(join(directory, path), content);
    })
  );

  // Append API key to .env.local if provided
  if (apiKey && apiKey.trim() !== "") {
    const envFilePath = join(directory, ".env.local");
    let existingContent = "";

    // Read existing content if file exists
    try {
      existingContent = await readFile(envFilePath, "utf-8");
    } catch (error) {
      // File doesn't exist yet, that's fine
    }

    // Ensure existing content ends with newline if it has content
    if (existingContent.length > 0 && !existingContent.endsWith("\n")) {
      existingContent += "\n";
    }

    const newContent = existingContent + `${envVarName}=${apiKey}\n`;
    await writeFile(envFilePath, newContent);
    log.success(`API key saved to .env.local`);
  }

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
