import {
  InternalAPIServerListenPortEnvironmentVariable,
  InternalAPIServerURLEnvironmentVariable,
} from "@blink.so/runtime/types";
import { serve } from "bun";
import { exec, spawn } from "child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const IMAGE_TAG = "blink-dev";
const WORKSPACE_CONTAINER_PREFIX = "blink-dev-workspace";
const RUNTIME_CONTAINER_PREFIX = "blink-dev-runtime";
const containerMap = new Map<string, { containerId: string }>();

// Find a free port on the host machine
async function findFreePort() {
  for (let i = 0; i < 100; i++) {
    try {
      return new Promise<number>((resolve, reject) => {
        const server = net.createServer();
        server
          .listen(0, "127.0.0.1")
          .on("listening", () => {
            // @ts-expect-error
            const port = server.address()?.port;
            resolve(port);
            server.close();
            console.log(`Found free port: ${port}`);
          })
          .on("error", (err) => {
            reject(err);
          });
      });
    } catch (err) {}
  }
  throw new Error("Failed to find a free port");
}

async function clearContainersWithPrefix(prefix: string) {
  try {
    // Get all containers with our prefix
    const { stdout } = await execAsync(
      `docker ps -a --format "{{.Names}}" | grep "^${prefix}-" || true`
    );

    const containerNames = stdout
      .trim()
      .split("\n")
      .filter((name) => name);

    if (containerNames.length > 0) {
      console.log(`Removing ${containerNames.length} existing containers...`);
      await execAsync(`docker rm -f ${containerNames.join(" ")}`);
    }
  } catch (error) {
    console.warn("Error clearing containers:", error);
  }
}

// Clear existing containers with the tag/prefix
async function clearExistingWorkspaceContainers() {
  console.log("Clearing existing workspace containers...");

  await clearContainersWithPrefix(WORKSPACE_CONTAINER_PREFIX);
}

async function clearExistingRuntimeContainers() {
  console.log("Clearing existing runtime containers...");

  await clearContainersWithPrefix(RUNTIME_CONTAINER_PREFIX);
}

// Spawn container for an ID
async function spawnWorkspaceContainer(
  id: string,
  env: Record<string, string> = {}
): Promise<{ containerId: string }> {
  const containerName = `${WORKSPACE_CONTAINER_PREFIX}-${id}`;

  console.log(`Spawning workspace container for ID: ${id}`);

  // Build environment variables for docker command
  const envVars = {
    BLINK_URL: "http://127.0.0.1:8787/api/connect",
    ...env, // Allow overriding defaults
  };

  const envFlags = Object.entries(envVars)
    .map(([key, value]) => `-e ${key}=${JSON.stringify(value)}`)
    .join(" ");

  if (Object.keys(env).length > 0) {
    console.log(`Environment variables: ${Object.keys(env).join(", ")}`);
  }

  try {
    const { stdout, stderr } = await execAsync(
      `docker run --network=host -d ${envFlags} --name ${containerName} ${IMAGE_TAG}`
    );

    const containerId = stdout.trim();
    console.log(`Container spawned: ${containerId} (${containerName})`);

    console.log("stdout", stdout, "stderr", stderr);

    return { containerId };
  } catch (error) {
    console.error(`Failed to spawn container for ID ${id}:`, error);
    throw error;
  }
}

// Spawn container for an ID
async function spawnRuntimeContainer(
  id: string,
  volumePath: string,
  entrypoint: string,
  env: Record<string, string> = {}
): Promise<{ containerId: string; port: number }> {
  const containerName = `${RUNTIME_CONTAINER_PREFIX}-${id}`;

  console.log(`Spawning runtime container for ID: ${id}`);

  // Build environment variables for docker command
  const envVars = {
    ...env, // Allow overriding defaults
  };

  const internalAPIServerPort = await findFreePort();
  const externalAgentServerPort = await findFreePort();
  envVars[InternalAPIServerListenPortEnvironmentVariable] =
    internalAPIServerPort.toString();
  envVars.PORT = externalAgentServerPort.toString();

  const envFlags = Object.entries(envVars)
    .map(([key, value]) => `-e ${key}=${JSON.stringify(value)}`)
    .join(" ");

  if (Object.keys(env).length > 0) {
    console.log(`Environment variables: ${Object.keys(env).join(", ")}`);
  }

  try {
    const cmd = `docker run --network=host -d ${envFlags} --name ${containerName} -v ${volumePath}:/app -w /app node:22 node ${entrypoint}`;
    console.log("Running command:", cmd);
    const { stdout, stderr } = await execAsync(cmd);

    const containerId = stdout.trim();
    console.log(`Container spawned: ${containerId} (${containerName})`);

    console.log("stdout", stdout, "stderr", stderr);

    return { containerId, port: externalAgentServerPort };
  } catch (error) {
    console.error(`Failed to spawn container for ID ${id}:`, error);
    throw error;
  }
}

// Spawn wrangler dev process
function spawnWranglerDev(serverPort: number) {
  console.log(
    `Starting wrangler dev with LOCAL_SHIMS_URL=http://127.0.0.1:${serverPort}`
  );

  // Fix SSL certificate path for macOS
  const sslCertFile =
    process.platform === "darwin"
      ? "/etc/ssl/cert.pem" // macOS path
      : "/etc/ssl/certs/ca-certificates.crt"; // Linux path

  const wranglerProcess = spawn(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "node_modules",
      "wrangler",
      "bin",
      "wrangler.js"
    ),
    ["dev", "--var", `LOCAL_SHIMS_URL:http://127.0.0.1:${serverPort}`],
    {
      env: {
        ...process.env,
        SSL_CERT_FILE: sslCertFile,
      },
      stdio: "inherit",
      cwd: path.resolve(__dirname, ".."),
    }
  );

  wranglerProcess.on("close", (code) => {
    process.exit(code ?? 0);
  });

  return wranglerProcess;
}

// Initialize
async function initialize() {
  await clearExistingWorkspaceContainers();

  // If the "--clean" flag is provided, clear existing runtime containers
  if (process.argv.includes("--clean")) {
    await clearExistingRuntimeContainers();
  }
}

// Start the server
const server = serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);

    try {
      if (url.pathname === "/deploy-agent" && req.method === "POST") {
        const body = (await req.json()) as {
          id: string;
          entrypoint: string;
          files: Record<string, string>;
          env: Record<string, string>;
        };

        const runtime = await import("@blink.so/runtime/node/wrapper");
        const agentDir = await mkdtemp(join(tmpdir(), "agent-"));
        body.files["__wrapper.js"] = runtime.default;
        body.env.ENTRYPOINT = `./${body.entrypoint}`;
        body.entrypoint = "__wrapper.js";
        body.env[InternalAPIServerURLEnvironmentVariable] =
          `http://127.0.0.1:8787`;
        for (const [key, value] of Object.entries(body.files)) {
          await writeFile(join(agentDir, key), value);
        }

        const runtimeContainer = await spawnRuntimeContainer(
          body.id,
          agentDir,
          body.entrypoint,
          body.env
        );

        return new Response(
          JSON.stringify({
            id: body.id,
            port: runtimeContainer.port,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (url.pathname === "/container-start" && req.method === "POST") {
        const body = (await req.json()) as { token: string };
        if (!body.token) {
          return new Response("Missing 'token' in request body", {
            status: 400,
          });
        }

        // Generate a unique ID for this workspace
        const id = crypto.randomUUID();

        // Spawn new container with token
        const containerInfo = await spawnWorkspaceContainer(id, {
          BLINK_TOKEN: body.token,
        });
        containerMap.set(id, containerInfo);

        console.log(
          `Started workspace ${id} with token: ${body.token.substring(0, 20)}...`
        );

        return new Response(
          JSON.stringify({
            id,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.pathname === "/container-stop" && req.method === "POST") {
        const body = (await req.json()) as { id: string };
        if (!body.id) {
          return new Response("Missing 'id' in request body", { status: 400 });
        }

        const containerInfo = containerMap.get(body.id);
        if (!containerInfo) {
          return new Response("Container not found", { status: 404 });
        }

        // Stop the container
        await execAsync(`docker stop ${containerInfo.containerId}`);
        console.log(
          `Stopped container ${containerInfo.containerId} for workspace ${body.id}`
        );

        return new Response("OK", { status: 200 });
      }

      if (url.pathname === "/container-delete" && req.method === "POST") {
        const body = (await req.json()) as { id: string };
        if (!body.id) {
          return new Response("Missing 'id' in request body", { status: 400 });
        }

        const containerInfo = containerMap.get(body.id);
        if (!containerInfo) {
          return new Response("Container not found", { status: 404 });
        }

        // Stop and remove the container
        try {
          await execAsync(`docker rm -f ${containerInfo.containerId}`);
        } catch (error) {
          // Container might already be stopped/removed, that's okay
          console.warn(`Warning removing container: ${error}`);
        }

        containerMap.delete(body.id);
        console.log(
          `Deleted container ${containerInfo.containerId} for workspace ${body.id}`
        );

        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(`Error handling request:`, error);
      return new Response(`Error: ${error}`, { status: 500 });
    }
  },
  websocket: {
    message(ws, message) {
      // WebSocket message handling can be implemented here if needed
    },
  },
});

const serverPort = server.port;
if (!serverPort) {
  console.error("Failed to get server port");
  process.exit(1);
}

console.log(`Server starting on port ${serverPort}`);

// Initialize and start wrangler
initialize()
  .then(() => {
    console.log("Initialization complete");
    spawnWranglerDev(serverPort);
  })
  .catch((error) => {
    console.error("Initialization failed:", error);
    process.exit(1);
  });

// Cleanup on exit
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await clearExistingWorkspaceContainers();
  process.exit(0);
});
