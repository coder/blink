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
import { mkdir, readdir, writeFile } from "fs/promises";
import { basename, join } from "path";

export default async function init(directory?: string): Promise<void> {
  if (!directory) {
    directory = process.cwd();
  }

  intro("Initializing a new Blink Agent");

  if ((await readdir(directory)).length > 0) {
    const useBlinkDir = await confirm({
      message:
        'Directory is not empty. Create agent in ".blink" instead? Blink looks for the nearest ".blink" directory for agents.',
    });
    if (isCancel(useBlinkDir)) {
      cancel("Initialization cancelled.");
      process.exit(1);
    }
    if (useBlinkDir) {
      directory = join(directory, ".blink");
      await mkdir(directory, { recursive: true });
      log.info(`Creating project in ${directory}`);
    } else {
      const confirmed = await confirm({
        message: "Initialize in non-empty directory anyway?",
      });
      if (confirmed === false || isCancel(confirmed)) {
        cancel("Initialization cancelled.");
        process.exit(1);
      }
    }
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

  const files = {
    "package.json": JSON.stringify({
      name,
      main: "agent.ts",
      type: "module",
      private: true,
      scripts: {
        dev: "blink dev",
        deploy: "blink deploy",
      },
    }),
    "agent.ts": `import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: blink.model("anthropic/claude-sonnet-4.5"),
    system: \`You are a basic agent the user will customize.

Suggest the user enters edit mode with Ctrl+E or /edit to customize the agent.
Demonstrate your capabilities with the IP tool.\`,
    messages: convertToModelMessages(messages),
    tools: {
      get_ip_info: tool({
        description: "Get IP address information of the computer.",
        inputSchema: z.object({}),
        execute: async () => {
          const response = await fetch("https://ipinfo.io/json");
          return response.json();
        },
      }),
    },
  });
});

agent.serve();
`,
    ".gitignore": `# dependencies
node_modules

# config and build
data

# dotenv environment variables file
.env
.env.*

# Finder (MacOS) folder config
.DS_Store
`,
    ".env.local": `
# Store local environment variables here.
# They will be used by blink dev for development.
# EXTERNAL_SERVICE_API_KEY=
`,

    ".env.production": `
# Store production environment variables here.
# They will be upserted as secrets on blink deploy.
# EXTERNAL_SERVICE_API_KEY=
`,
    "AGENTS.md": `Assist the user in developing an agent.

- Use AI SDK v5 for tool-call syntax (inputSchema instead of parameters).
- Store local environment secrets in .env.local.
- Store production environment secrets in .env.production.
- Run "blink deploy" to deploy an agent to the cloud.
- Run "blink deploy --prod" to deploy to production.
- The user can run "blink dev" to start a development server.
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "noEmit": true,

    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    "noUnusedLocals": false,
    "noUnusedParameters": false,

    "types": ["node"]
  }
}`,
  };

  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await writeFile(join(directory, path), content);
    })
  );

  // Log a newline which makes it look a bit nicer.
  console.log("");
  const child = spawn(
    packageManager,
    [
      packageManager === "yarn" ? "add" : "install",
      "--save-dev",
      "zod",
      "ai",
      "blink",
      "esbuild",
      "@types/node",
      "typescript",
    ],
    {
      stdio: "inherit",
      cwd: directory,
    }
  );

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
