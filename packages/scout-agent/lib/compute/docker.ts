import { exec as execChildProcess } from "node:child_process";
import crypto from "node:crypto";
import util from "node:util";
import type { Client } from "@blink-sdk/compute-protocol/client";
import { WebSocket } from "ws";
import { z } from "zod";
import { newComputeClient } from "./common";

const exec = util.promisify(execChildProcess);

// typings on ExecException are incorrect, see https://github.com/nodejs/node/issues/57392
const parseExecOutput = (output: unknown): string => {
  if (typeof output === "string") {
    return output;
  }
  if (output instanceof Buffer) {
    return output.toString("utf-8");
  }
  return util.inspect(output);
};

const execProcess = async (
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  try {
    const output = await exec(command, {});
    return {
      stdout: parseExecOutput(output.stdout),
      stderr: parseExecOutput(output.stderr),
      exitCode: 0,
    };
    // the error should be an ExecException from node:child_process
  } catch (error: unknown) {
    if (!(typeof error === "object" && error !== null)) {
      throw error;
    }
    return {
      stdout: "stdout" in error ? parseExecOutput(error.stdout) : "",
      stderr: "stderr" in error ? parseExecOutput(error.stderr) : "",
      exitCode: "code" in error ? (error.code as number) : 1,
    };
  }
};

const dockerWorkspaceInfoSchema: z.ZodObject<{
  containerName: z.ZodString;
}> = z.object({
  containerName: z.string(),
});

type DockerWorkspaceInfo = z.infer<typeof dockerWorkspaceInfoSchema>;

const COMPUTE_SERVER_PORT = 22137;
const BOOTSTRAP_SCRIPT = `
#!/bin/sh
echo "Installing blink..."
npm install -g blink@latest

HOST=0.0.0.0 PORT=${COMPUTE_SERVER_PORT} blink compute server
`.trim();
const BOOTSTRAP_SCRIPT_BASE64 =
  Buffer.from(BOOTSTRAP_SCRIPT).toString("base64");

const DOCKERFILE = `
FROM node:24-bullseye-slim

RUN apt update && apt install git -y
RUN (type -p wget >/dev/null || (apt update && apt install wget -y)) \\
	&& mkdir -p -m 755 /etc/apt/keyrings \\
	&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
	&& cat $out | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \\
	&& chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\
	&& mkdir -p -m 755 /etc/apt/sources.list.d \\
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
	&& apt update \\
	&& apt install gh -y
RUN npm install -g blink@latest
`.trim();
const DOCKERFILE_HASH = crypto
  .createHash("sha256")
  .update(DOCKERFILE)
  .digest("hex")
  .slice(0, 16);
const DOCKERFILE_BASE64 = Buffer.from(DOCKERFILE).toString("base64");

export const initializeDockerWorkspace =
  async (): Promise<DockerWorkspaceInfo> => {
    const { exitCode: versionExitCode } = await execProcess("docker --version");
    if (versionExitCode !== 0) {
      throw new Error(
        `Docker is not available. Please install it or choose a different workspace provider.`
      );
    }

    const imageName = `blink-workspace:${DOCKERFILE_HASH}`;
    const { exitCode: dockerImageExistsExitCode } = await execProcess(
      `docker image inspect ${imageName}`
    );
    if (dockerImageExistsExitCode !== 0) {
      const buildCmd = `echo "${DOCKERFILE_BASE64}" | base64 -d | docker build -t ${imageName} -f - .`;
      const {
        exitCode: buildExitCode,
        stdout: buildStdout,
        stderr: buildStderr,
      } = await execProcess(buildCmd);
      if (buildExitCode !== 0) {
        throw new Error(
          `Failed to build docker image ${imageName}. Build output: ${buildStdout}\n${buildStderr}`
        );
      }
    }

    const containerName = `blink-workspace-${crypto.randomUUID()}`;
    const { exitCode: runExitCode } = await execProcess(
      `docker run -d --publish ${COMPUTE_SERVER_PORT} --name ${containerName} ${imageName} bash -c 'echo "${BOOTSTRAP_SCRIPT_BASE64}" | base64 -d | bash'`
    );
    if (runExitCode !== 0) {
      throw new Error(`Failed to run docker container ${containerName}`);
    }

    const timeout = 60000;
    const start = Date.now();
    while (true) {
      const {
        exitCode: inspectExitCode,
        stdout,
        stderr,
      } = await execProcess(
        `docker container inspect -f json ${containerName}`
      );
      if (inspectExitCode !== 0) {
        throw new Error(
          `Failed to run docker container ${containerName}. Inspect failed: ${stdout}\n${stderr}`
        );
      }
      const inspectOutput = dockerInspectSchema.parse(JSON.parse(stdout));
      if (!inspectOutput[0]?.State.Running) {
        throw new Error(`Docker container ${containerName} is not running.`);
      }
      if (Date.now() - start > timeout) {
        throw new Error(
          `Timeout waiting for docker container ${containerName} to start.`
        );
      }
      const {
        exitCode: logsExitCode,
        stdout: logsOutput,
        stderr: logsStderr,
      } = await execProcess(`docker container logs ${containerName}`);
      if (logsExitCode !== 0) {
        throw new Error(
          `Failed to get logs for docker container ${containerName}. Logs: ${logsOutput}\n${logsStderr}`
        );
      }
      if (logsOutput.includes("Compute server running")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { containerName };
  };

const dockerInspectSchema = z.array(
  z.object({
    State: z.object({ Running: z.boolean() }),
    NetworkSettings: z.object({
      IPAddress: z.string(),
      Ports: z.object({
        [`${COMPUTE_SERVER_PORT}/tcp`]: z.array(
          z.object({ HostPort: z.string() })
        ),
      }),
    }),
  })
);

export const getDockerWorkspaceClient = async (
  workspaceInfoRaw: unknown
): Promise<Client> => {
  const {
    data: workspaceInfo,
    success,
    error,
  } = dockerWorkspaceInfoSchema.safeParse(workspaceInfoRaw);
  if (!success) {
    throw new Error(`Invalid workspace info: ${error.message}`);
  }

  const { stdout: dockerInspectRawOutput, exitCode: inspectExitCode } =
    await execProcess(
      `docker container inspect -f json ${workspaceInfo.containerName}`
    );
  if (inspectExitCode !== 0) {
    throw new Error(
      `Failed to inspect docker container ${workspaceInfo.containerName}. Initialize a new workspace with initialize_workspace first.`
    );
  }
  const dockerInspect = dockerInspectSchema.parse(
    JSON.parse(dockerInspectRawOutput)
  );
  const ipAddress = dockerInspect[0]?.NetworkSettings.IPAddress;
  if (!ipAddress) {
    throw new Error(
      `Could not find IP address for docker container ${workspaceInfo.containerName}`
    );
  }
  if (!dockerInspect[0]?.State.Running) {
    throw new Error(
      `Docker container ${workspaceInfo.containerName} is not running.`
    );
  }
  const hostPort =
    dockerInspect[0]?.NetworkSettings.Ports[`${COMPUTE_SERVER_PORT}/tcp`]?.[0]
      ?.HostPort;
  if (!hostPort) {
    throw new Error(
      `Could not find host port for docker container ${workspaceInfo.containerName}`
    );
  }
  return newComputeClient(new WebSocket(`ws://localhost:${hostPort}`));
};
