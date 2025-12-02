import * as convert from "@blink.so/database/convert";
import Querier from "@blink.so/database/querier";
import type { AgentDeployment } from "@blink.so/database/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
  withPagination,
} from "../../middleware";
import type { Bindings } from "../../server";
import {
  schemaCreateAgentDeploymentRequest,
  type AgentDeploymentFile,
  type AgentDeploymentTarget,
  type AgentDeploymentUploadFile,
  type ListAgentDeploymentsResponse,
} from "./deployments.client";

// /api/agents/:id/deployments
export default function mountDeployments(
  app: Hono<{
    Bindings: Bindings;
  }>
) {
  // List deployments.
  app.get(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    withPagination,
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();
      const deployments = await db.selectAgentDeploymentsByAgentID({
        agentID: agent.id,
        page: c.get("page"),
        per_page: c.get("per_page"),
      });
      const listDeployments: ListAgentDeploymentsResponse = {
        has_more: deployments.has_more,
        items: deployments.items.map(convert.agentDeployment),
      };
      return c.json(listDeployments);
    }
  );

  // Create a deployment.
  app.post(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (data) => {
      return schemaCreateAgentDeploymentRequest.parse(data);
    }),
    async (c) => {
      const agent = c.get("agent");
      const req = c.req.valid("json");

      const deployment = await createAgentDeployment({
        req: c.req.raw,
        bindings: c.env,
        sourceFiles: req.source_files,
        outputFiles: req.output_files,
        entrypoint: req.entrypoint,
        agentID: agent.id,
        userID: c.get("user_id"),
        organizationID: agent.organization_id,
        target: req.target,
        userMessage: req.message,
      });
      return c.json(convert.agentDeployment(deployment));
    }
  );

  // Get a deployment.
  app.get(
    "/:deployment_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      const agent = c.get("agent");
      const deploymentID = c.req.param("deployment_id");

      let deployment: (AgentDeployment & { target: string }) | null = null;
      const db = await c.env.database();
      if (deploymentID.match(/^\d+$/)) {
        deployment = await db.selectAgentDeploymentByNumber(
          agent.id,
          parseInt(deploymentID)
        );
      } else {
        deployment = await db.selectAgentDeploymentByID(deploymentID);
      }
      if (!deployment) {
        throw new HTTPException(404, {
          message: "Deployment not found",
        });
      }
      if (deployment.agent_id !== agent.id) {
        throw new HTTPException(404, {
          message: "Deployment not found",
        });
      }
      return c.json(convert.agentDeployment(deployment));
    }
  );

  // Re-deploy an existing deployment.
  app.post(
    "/:deployment_id/redeploy",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    async (c) => {
      const agent = c.get("agent");
      const deploymentID = c.req.param("deployment_id");
      const db = await c.env.database();

      let existingDeployment: (AgentDeployment & { target: string }) | null =
        null;
      if (deploymentID.match(/^\d+$/)) {
        existingDeployment = await db.selectAgentDeploymentByNumber(
          agent.id,
          parseInt(deploymentID)
        );
      } else {
        existingDeployment = await db.selectAgentDeploymentByID(deploymentID);
      }
      if (!existingDeployment) {
        throw new HTTPException(404, {
          message: "Deployment not found",
        });
      }
      if (existingDeployment.agent_id !== agent.id) {
        throw new HTTPException(404, {
          message: "Deployment not found",
        });
      }

      const deployment = await createAgentDeployment({
        req: c.req.raw,
        bindings: c.env,
        db,
        sourceFiles: existingDeployment.source_files ?? undefined,
        outputFiles: existingDeployment.output_files ?? undefined,
        entrypoint: existingDeployment.entrypoint,
        agentID: agent.id,
        userID: c.get("user_id"),
        organizationID: agent.organization_id,
        target: existingDeployment.target as AgentDeploymentTarget,
        userMessage: existingDeployment.user_message ?? undefined,
      });
      return c.json(convert.agentDeployment(deployment));
    }
  );
}

export const createAgentDeployment = async ({
  req,
  db,
  bindings,
  sourceFiles,
  outputFiles,
  entrypoint,
  agentID,
  userID,
  organizationID,
  target,
  userMessage,
}: {
  req: Request;
  bindings: Bindings;
  db?: Querier;
  sourceFiles?: AgentDeploymentUploadFile[];
  outputFiles?: AgentDeploymentUploadFile[];
  entrypoint?: string;
  agentID: string;
  userID: string;
  organizationID: string;
  target: AgentDeploymentTarget;
  userMessage?: string;
}) => {
  if (!db) {
    db = await bindings.database();
  }

  // Check that files are provided.
  if (outputFiles?.length === 0 && sourceFiles?.length === 0) {
    throw new HTTPException(400, {
      message: "No output files or source files provided",
    });
  }

  // If there are output files, ensure the entrypoint is in the output files.
  if (outputFiles?.length && entrypoint) {
    if (!outputFiles.find((file) => file.path === entrypoint)) {
      throw new HTTPException(400, {
        message:
          "Entrypoint not found in output files. You must specify entrypoint to build your agent.",
      });
    }
  }

  // If there are *only* source files, we'll need to queue a build.
  // In that case, we need to make sure the entrypoint is in the source files.
  //
  // TODO: This can be inferred as part of our build, so entrypoint should
  // probably be optional.
  if (sourceFiles?.length && !outputFiles?.length && entrypoint) {
    if (!sourceFiles.find((file) => file.path === entrypoint)) {
      throw new HTTPException(400, {
        message:
          "Entrypoint not found in source files. You must specify entrypoint to build your agent.",
      });
    }
  }

  const uploadFiles = async (files: AgentDeploymentUploadFile[]) => {
    const uploadedFiles: AgentDeploymentFile[] = [];
    for (const file of files) {
      if ("data" in file) {
        const { id } = await bindings.files.upload({
          file: new File([file.data], file.path),
          user_id: userID,
          organization_id: organizationID,
        });
        uploadedFiles.push({
          path: file.path,
          id,
        });
      } else {
        uploadedFiles.push(file);
      }
    }
    return uploadedFiles;
  };

  const uploadedSourceFiles = await uploadFiles(sourceFiles ?? []);
  const uploadedOutputFiles = await uploadFiles(outputFiles ?? []);

  // Validate total size of output files does not exceed 25MB.
  if (uploadedOutputFiles.length > 0) {
    let totalSize = 0;
    for (const file of uploadedOutputFiles) {
      const fileData = await bindings.files.download(file.id);
      totalSize += fileData.size;
      // Cancel the stream to avoid memory leaks.
      await fileData.stream.cancel();
    }
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (totalSize > maxSize) {
      throw new HTTPException(400, {
        message: `Total size of output files (${(totalSize / 1024 / 1024).toFixed(2)}MB) exceeds the maximum allowed size of 25MB`,
      });
    }
  }

  const deploymentTarget = await db.selectAgentDeploymentTargetByName(
    agentID,
    target
  );
  if (!deploymentTarget) {
    throw new HTTPException(400, {
      message: "Target not found",
    });
  }

  const deployment = await db.insertAgentDeployment({
    agent_id: agentID,
    source_files: uploadedSourceFiles,
    output_files: uploadedOutputFiles,
    status: "pending",
    target_id: deploymentTarget.id,
    compatibility_version: "3",
    entrypoint: entrypoint ?? "",
    created_by: userID,
    created_from: "cli",
    user_message: userMessage,
    platform: "lambda",
    platform_memory_mb: 1024,
  });
  await bindings.deployAgent(deployment);
  return {
    ...deployment,
    target: deploymentTarget.target,
  };
};
