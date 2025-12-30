import type Querier from "@blink.so/database/querier";
import type { AgentDeployment as DBAgentDeployment } from "@blink.so/database/schema";
import { deploy as deployLambda } from "@blink.so/runtime/lambda";
import type { FileUpload } from "@daytonaio/sdk/src/FileSystem";
import { DurableObject } from "cloudflare:workers";
import { join } from "node:path";
import type { AgentDeploymentFile } from "../../api/src/client.browser";
import { uploadToR2 } from "./chat/upload-to-r2";
import connectToDatabase from "./database";
import { writePlatformLog } from "./logs/client";

// DurableObjects have 1GB of memory. This should be more than enough
// for all deployments in the short-term.
export class AgentDeployment extends DurableObject<Cloudflare.Env> {
  private deployment?: DBAgentDeployment;

  public constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.deployment = await this.ctx.storage.get("deployment");
    });
  }

  public async deploy(deployment: DBAgentDeployment) {
    this.deployment = deployment;
    await this.ctx.storage.put("deployment", deployment);
    this.ctx.storage.setAlarm(Date.now());
  }

  public async alarm() {
    const deployment = this.deployment;
    if (!deployment) {
      return;
    }
    const db = await connectToDatabase(this.env);
    try {
      await this.doDeploy(db, deployment);
    } catch (err) {
      console.error("Failed to deploy agent", err);
      // Update the deployment with the error.
      await db.updateAgentDeployment({
        id: deployment.id,
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
      });
      await writePlatformLog(this.env, {
        agentId: deployment.agent_id,
        event: {
          type: "blink.deploy.failure",
          level: "error",
          ts: new Date().toISOString(),
          source: "platform",
          message: `Failed to deploy agent ${deployment.agent_id}`,
          agent: {
            id: deployment.agent_id,
            deployment_id: deployment.id,
            target_id: deployment.target_id,
          },
          correlation: {
            deployment_id: deployment.id,
          },
          error: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  }

  private async doDeploy(db: Querier, deployment: DBAgentDeployment) {
    const envs = await db.selectAgentEnvironmentVariablesByAgentID({
      agentID: deployment.agent_id,
    });
    const target = await db.selectAgentDeploymentTargetByID(
      deployment.target_id
    );
    const lambdaEnv: Record<string, string> = {
      BLINK_REQUEST_URL: `https://${target?.request_id}.blink.host`,
    };
    for (const env of envs) {
      if (env.value !== null) {
        lambdaEnv[env.key] = env.value;
      }
    }

    // This is an experimental temporary hack to build agents in the cloud.
    if (deployment.source_files?.length && !deployment.output_files?.length) {
      // We need to spawn a container to do the build.
      const { entrypoint, outputFiles } = await experimentalBuildAgent({
        env: lambdaEnv,
        cfEnv: this.env,
        sourceFiles: deployment.source_files,
      });
      await db.updateAgentDeployment({
        id: deployment.id,
        output_files: outputFiles,
        entrypoint,
      });
      deployment.output_files = outputFiles;
      deployment.entrypoint = entrypoint;
    }
    if (!deployment.output_files) {
      throw new Error("No output files provided");
    }

    await db.updateAgentDeployment({
      id: deployment.id,
      status: "deploying",
    });

    await writePlatformLog(this.env, {
      agentId: deployment.agent_id,
      event: {
        type: "blink.deploy.start",
        level: "info",
        ts: new Date().toISOString(),
        message: `Deploying agent ${deployment.agent_id}`,
        source: "platform",
        agent: {
          id: deployment.agent_id,
          deployment_id: deployment.id,
          target_id: deployment.target_id,
        },
        correlation: {
          deployment_id: deployment.id,
        },
      },
    });

    // Stream files directly from R2 without loading into memory
    // Process files in batches to avoid hitting Cloudflare's parallel HTTP limit
    const streamFiles = async function* (
      files: NonNullable<typeof deployment.output_files>,
      env: Env
    ) {
      const BATCH_SIZE = 5;

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (file) => {
          const r2Object = await env.USER_FILES.get(file.id);
          if (!r2Object) {
            throw new Error(`File ${file.id} not found`);
          }
          return { path: file.path, content: r2Object.body };
        });

        const results = await Promise.all(promises);
        for (const result of results) {
          yield result;
        }
      }

      // Everything is an ESM module
      yield {
        path: "package.json",
        content: JSON.stringify({ type: "module" }),
      };
    };

    const hasAWSCredentials =
      this.env.AWS_ACCESS_KEY_ID &&
      this.env.AWS_SECRET_ACCESS_KEY &&
      this.env.AWS_LAMBDA_ROLE_ARN &&
      this.env.AWS_REGION;

    let deployedURL: string;
    // Determine whether we use local.
    if (this.env.LOCAL_SHIMS_URL && !hasAWSCredentials) {
      // For local deployment, we need to collect files into an object
      const lambdaFiles: Record<string, string> = {};
      for await (const { path, content } of streamFiles(
        deployment.output_files,
        this.env
      )) {
        // Local shims need strings, so materialize streams
        if (content instanceof ReadableStream) {
          const text = await new Response(content).text();
          lambdaFiles[path] = text;
        } else {
          lambdaFiles[path] = content;
        }
      }

      const resp = await fetch(
        new URL("/deploy-agent", this.env.LOCAL_SHIMS_URL),
        {
          method: "POST",
          body: JSON.stringify({
            id: deployment.id,
            files: lambdaFiles,
            entrypoint: deployment.entrypoint,
            env: lambdaEnv,
          }),
        }
      );
      if (resp.status !== 200) {
        const text = await resp.text();
        throw new Error(`Failed to start container: ${text}`);
      }
      const { port } = (await resp.json()) as { id: string; port: number };
      const url = `http://127.0.0.1:${port}`;
      await db.updateAgentDeployment({
        id: deployment.id,
        status: "deploying",
        platform: "lambda",
        platform_region: "us-east-1",
        direct_access_url: url,
      });
      deployedURL = url;
    } else {
      if (!hasAWSCredentials) {
        throw new Error("AWS credentials not provided");
      }
      if (this.env.LOCAL_SHIMS_URL) {
        console.warn(`Because AWS credentials are provided, we're deploying to AWS.
    Omit AWS credentials from the environment to deploy to a local container.`);
      }
      const { url, arn } = await deployLambda({
        aws: {
          accessKeyId: this.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: this.env.AWS_SECRET_ACCESS_KEY!,
          region: this.env.AWS_REGION!,
        },
        lambdaRoleArn: this.env.AWS_LAMBDA_ROLE_ARN!,
        id: deployment.id,
        // All deployments of the same agent share the same log group.
        logGroupName: `blink/agent/${deployment.agent_id}`,
        files: streamFiles(deployment.output_files, this.env),
        entrypoint: deployment.entrypoint,
        env: lambdaEnv,
        memoryMB: deployment.platform_memory_mb,
      });

      await db.updateAgentDeployment({
        id: deployment.id,
        status: "deploying",
        platform: "lambda",
        platform_metadata: {
          type: "lambda",
          arn,
        },
        direct_access_url: url,
        platform_region: this.env.AWS_REGION!,
      });
      deployedURL = url;
    }

    // It should always take less than 30 seconds to deploy.
    // Obviously, this should move to a queue in case this
    // is not the case.
    const globalSignal = AbortSignal.timeout(30_000);

    // This waits for the Lambda to be ready in almost
    // the jankiest way it gets. This should obviously
    // be replaced with a queue.
    let requestSignal: AbortSignal;
    let lastAttempt = 0;
    const healthURL = new URL("/_agent/health", deployedURL);
    while (true) {
      // Add a small delay between attempts to avoid hammering
      // the Lambda. This is useful locally as well.
      if (Date.now() - lastAttempt < 1_000) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            resolve();
          }, 500);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          requestSignal.addEventListener("abort", onAbort, { once: true });
        });
      }
      lastAttempt = Date.now();
      requestSignal = AbortSignal.timeout(3_000);
      try {
        // We check for the `/_agent/health` endpoint to ensure
        // that the agent is ready to serve requests.
        const resp = await fetch(healthURL, {
          method: "GET",
          signal: AbortSignal.any([globalSignal, requestSignal]),
        });
        // Cancel the response body to prevent stalled HTTP response warnings.
        // Must await the cancel to properly signal to Cloudflare we're done.
        if (resp.body) {
          await resp.body.cancel();
        }
        if (resp.status === 200) {
          break;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            resolve();
          }, 250);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          requestSignal.addEventListener("abort", onAbort, { once: true });
        });
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "TimeoutError")
        ) {
          if (globalSignal.aborted) {
            throw new Error("Deployment timed out waiting to become ready");
          }
          continue;
        }
        // This *only* occurs locally.
        if (err instanceof Error && "retryable" in err) {
          if (err.retryable) {
            continue;
          }
        }
        throw err;
      }
    }

    await db.tx(async (tx) => {
      await tx.updateAgentDeployment({
        id: deployment.id,
        status: "success",
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

    // Log deployment success
    await writePlatformLog(this.env, {
      agentId: deployment.agent_id,
      event: {
        type: "blink.deploy.success",
        level: "info",
        ts: new Date().toISOString(),
        source: "platform",
        message: `Deployed agent ${deployment.agent_id}`,
        agent: {
          id: deployment.agent_id,
          deployment_id: deployment.id,
          target_id: deployment.target_id,
        },
        correlation: {
          deployment_id: deployment.id,
        },
      },
    });
  }
}

// This builds an agent from source with Daytona.
const experimentalBuildAgent = async ({
  env,
  cfEnv,
  sourceFiles,
}: {
  env: Record<string, string>;
  cfEnv: Env;
  sourceFiles: AgentDeploymentFile[];
}) => {
  // We need to spawn a container to do the build.
  const { Daytona } = await import("@daytonaio/sdk");
  const daytona = new Daytona({
    apiKey: cfEnv.DAYTONA_API_KEY,
  });
  const container = await daytona.create({
    snapshot: "blink-workspace-august-17-2025",
    autoDeleteInterval: 5,
  });
  try {
    const uploads: FileUpload[] = [];
    for (const file of sourceFiles) {
      const content = await cfEnv.USER_FILES.get(file.id);
      if (!content) {
        throw new Error(`File ${file.id} not found`);
      }
      uploads.push({
        source: Buffer.from(await content.arrayBuffer()),
        destination: join("/workspace", file.path),
      });
    }
    await container.fs.uploadFiles(uploads);
    let result = await container.process.executeCommand(
      `bun i`,
      "/workspace",
      env,
      120
    );
    console.log("result", JSON.stringify(result, null, 2));
    result = await container.process.executeCommand(
      `blink build`,
      "/workspace",
      env,
      120
    );
    console.log("result", JSON.stringify(result, null, 2));
    const buildDir = "/workspace/.blink/build";
    const outputFiles = await container.fs.listFiles(buildDir);
    console.log("outputFiles", JSON.stringify(outputFiles, null, 2));
    const uploadFiles: AgentDeploymentFile[] = [];
    for (const file of outputFiles) {
      const content = await container.process.executeCommand(
        `cat ${join(buildDir, file.name)}`,
        "/workspace",
        env,
        120
      );
      // Now we need to upload to user files.
      const id = crypto.randomUUID();
      await uploadToR2(
        cfEnv.USER_FILES,
        id,
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(Buffer.from(content.result));
            controller.close();
          },
        }),
        "application/octet-stream",
        undefined,
        file.name
      );
      uploadFiles.push({
        id,
        path: file.name,
      });
    }
    return {
      entrypoint: `agent.js`,
      outputFiles: uploadFiles,
    };
  } finally {
    await container.delete();
  }
};
