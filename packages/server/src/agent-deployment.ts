import { generateAgentDeploymentToken } from "@blink.so/api/agents/me/server";
import type Querier from "@blink.so/database/querier";
import type { AgentDeployment } from "@blink.so/database/schema";
import {
  BlinkDeploymentTokenEnvironmentVariable,
  InternalAPIServerListenPortEnvironmentVariable,
  InternalAPIServerURLEnvironmentVariable,
} from "@blink.so/runtime/types";
import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { getDockerNetworkingConfig } from "./check-docker-networking";

interface DockerDeployOptions {
  deployment: AgentDeployment;
  querier: Querier;
  baseUrl: string;
  authSecret: string;
  image: string;
  downloadFile: (id: string) => Promise<{
    stream: ReadableStream;
    type: string;
    name: string;
    size: number;
  }>;
}

/**
 * Janky Docker-based agent deployment for self-hosted
 * This will download files, write them to a temp directory,
 * and run them in a Docker container.
 */
export async function deployAgentWithDocker(opts: DockerDeployOptions) {
  const { deployment, querier, baseUrl, authSecret, image, downloadFile } =
    opts;
  console.log(`Deploying agent ${deployment.agent_id} (${deployment.id})`);

  try {
    await querier.updateAgentDeployment({
      id: deployment.id,
      status: "deploying",
    });

    if (!deployment.output_files || deployment.output_files.length === 0) {
      throw new Error("No output files provided");
    }

    // Create a temp directory for this deployment
    const deploymentDir = join(tmpdir(), `blink-agent-${deployment.id}`);
    await mkdir(deploymentDir, { recursive: true });

    console.log(`Writing files to ${deploymentDir}`);

    // Download and write all files
    for (const file of deployment.output_files) {
      const fileData = await downloadFile(file.id);
      const filePath = join(deploymentDir, file.path);

      // Create parent directories if needed
      const parentDir = join(filePath, "..");
      await mkdir(parentDir, { recursive: true });

      // Convert ReadableStream to Buffer
      const reader = fileData.stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);

      await writeFile(filePath, buffer);
      console.log(`Wrote ${file.path} (${buffer.length} bytes)`);
    }

    // Add the node wrapper runtime
    const runtime = await import("@blink.so/runtime/node/wrapper");
    const wrapperPath = join(deploymentDir, "__wrapper.js");
    await writeFile(wrapperPath, runtime.default);
    console.log(`Wrote __wrapper.js (runtime wrapper)`);

    // The original entrypoint becomes an env var for the wrapper
    const originalEntrypoint = deployment.entrypoint;
    const wrapperEntrypoint = "__wrapper.js";

    // Get environment variables for the agent
    const envs = await querier.selectAgentEnvironmentVariablesByAgentID({
      agentID: deployment.agent_id,
    });
    const target = await querier.selectAgentDeploymentTargetByID(
      deployment.target_id
    );

    // Determine the best Docker networking mode for this system
    const networkConfig = await getDockerNetworkingConfig();
    console.log(`Docker networking config: ${JSON.stringify(networkConfig)}`);

    if (networkConfig.recommended === "none") {
      throw new Error(
        "Docker networking check failed: neither host networking nor port binding supports bidirectional communication between host and container. " +
          "Please check your Docker configuration."
      );
    }

    const useHostNetwork =
      networkConfig.recommended === "host" ||
      networkConfig.recommended === "both";

    // Find free ports for this agent (one for external access, one for internal API)
    const externalPort = await findFreePort();
    const internalAPIPort = await findFreePort();

    // Calculate the URL the container should use to reach the host
    let containerBaseUrl = baseUrl;
    if (!useHostNetwork && networkConfig.portBind.hostAddress) {
      // Replace the host in baseUrl with the address that works from the container
      const url = new URL(baseUrl);
      url.hostname = networkConfig.portBind.hostAddress;
      containerBaseUrl = url.toString().replace(/\/$/, ""); // Remove trailing slash
    }

    // Build Docker env args
    const dockerEnvArgs: string[] = [];
    // Wrapper runtime configuration
    dockerEnvArgs.push("-e", `ENTRYPOINT=./${originalEntrypoint}`);
    dockerEnvArgs.push(
      "-e",
      `${InternalAPIServerListenPortEnvironmentVariable}=${internalAPIPort}`
    );
    dockerEnvArgs.push(
      "-e",
      `${InternalAPIServerURLEnvironmentVariable}=${containerBaseUrl}`
    );
    // Agent configuration
    dockerEnvArgs.push("-e", `BLINK_REQUEST_URL=${containerBaseUrl}`);
    dockerEnvArgs.push("-e", `BLINK_REQUEST_ID=${target?.request_id}`);
    dockerEnvArgs.push("-e", `PORT=${externalPort}`);
    dockerEnvArgs.push("-e", `BLINK_USE_STRUCTURED_LOGGING=1`);
    // User-defined environment variables
    for (const envVar of envs) {
      if (envVar.value !== null) {
        dockerEnvArgs.push("-e", `${envVar.key}=${envVar.value}`);
      }
    }

    // Generate deployment token for OTLP authentication
    const deploymentToken = await generateAgentDeploymentToken(authSecret, {
      agent_id: deployment.agent_id,
      agent_deployment_id: deployment.id,
      agent_deployment_target_id: deployment.target_id,
    });
    dockerEnvArgs.push(
      "-e",
      `${BlinkDeploymentTokenEnvironmentVariable}=${deploymentToken}`
    );

    // Run docker container
    // Mount the deployment directory as /app
    // Expose the port so we can access the agent
    const containerName = `blink-agent-${deployment.agent_id}`;

    // Stop and remove existing container if it exists
    try {
      await runCommand("docker", ["stop", containerName]);
      await runCommand("docker", ["rm", containerName]);
    } catch {
      // Ignore errors if container doesn't exist
    }

    // Build docker args based on networking mode
    const dockerArgs = [
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      ...(useHostNetwork
        ? ["--network", "host"]
        : [
            "-p",
            `${externalPort}:${externalPort}`,
            "-p",
            `${internalAPIPort}:${internalAPIPort}`,
          ]),
      "-v",
      `${deploymentDir}:/app`,
      "-w",
      "/app",
      ...dockerEnvArgs,
      image,
      "bash",
      "-c",
      // Start the collector and pipe the agent's output to it
      `/opt/otel/start-collector.sh && node ${wrapperEntrypoint} 2>&1 | tee >(nc 127.0.0.1 54525)`,
    ];

    console.log(`Running: docker ${dockerArgs.join(" ")}`);
    const containerId = await runCommand("docker", dockerArgs);

    console.log(`Container started: ${containerId}`);

    // Update deployment status and set as active if target is production
    await querier.tx(async (tx) => {
      await tx.updateAgentDeployment({
        id: deployment.id,
        status: "success",
        direct_access_url: `http://localhost:${externalPort}`,
        platform_metadata: {
          type: "lambda",
          arn: `container:${containerId.trim()}`,
        },
      });

      const deploymentTarget = await tx.selectAgentDeploymentTargetByID(
        deployment.target_id
      );
      // TODO: We should probably not have this hardcoded.
      if (deploymentTarget && deploymentTarget.target === "production") {
        await tx.updateAgent({
          id: deployment.agent_id,
          active_deployment_id: deployment.id,
        });
      }
    });

    console.log(`Deployment ${deployment.id} successful`);
  } catch (error) {
    console.error(`Deployment ${deployment.id} failed:`, error);
    await querier.updateAgentDeployment({
      id: deployment.id,
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (error) => {
      reject(error);
    });
  });
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        const port = address.port;
        server.close(() => {
          resolve(port);
        });
      } else {
        server.close();
        reject(new Error("Failed to get port"));
      }
    });
    server.on("error", reject);
  });
}
