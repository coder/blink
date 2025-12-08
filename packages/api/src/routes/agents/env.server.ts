import {
  type Agent,
  type AgentEnvironmentVariable as DBAgentEnvironmentVariable,
} from "@blink.so/database/schema";
import { Hono, type MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import z from "zod";
import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
} from "../../middleware";
import type { Bindings } from "../../server";
import { isUniqueConstraintError } from "../../server-helper";
import {
  type AgentDeploymentTarget,
  schemaAgentDeploymentTarget,
} from "./deployments.client";
import {
  type AgentEnvironmentVariable,
  schemaCreateAgentEnvRequest,
  schemaUpdateAgentEnvRequest,
} from "./env.client";

export default function mountEnv(
  app: Hono<{
    Bindings: Bindings;
  }>
) {
  // List environment variables for an agent.
  app.get(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    validator("query", (value) => {
      let target: AgentDeploymentTarget[] | undefined;
      if (value["target"]) {
        if (!Array.isArray(value["target"])) {
          target = [schemaAgentDeploymentTarget.parse(value["target"])];
        } else {
          target = schemaAgentDeploymentTarget.array().parse(value["target"]);
        }
      }
      return { target };
    }),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();
      const env = await db.selectAgentEnvironmentVariablesByAgentID({
        agentID: agent.id,
        target: c.req.valid("query").target,
      });
      return c.json(env.map(convertAgentEnvironmentVariable));
    }
  );

  // Create an environment variable for an agent.
  app.post(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (value) => {
      return schemaCreateAgentEnvRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const req = c.req.valid("json");
      try {
        const envVar = await db.insertAgentEnvironmentVariable({
          agent_id: c.get("agent").id,
          key: req.key,
          value: req.value,
          secret: req.secret,
          target: req.target,
          created_by: c.get("user_id"),
          updated_by: c.get("user_id"),
        });
        return c.json(convertAgentEnvironmentVariable(envVar));
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          // TODO: We shouldn't be doing this. It's a race condition.
          // Kyle: I didn't feel like doing some crazy index upsert logic.
          if (req.upsert) {
            const envVar = await db.updateAgentEnvironmentVariableByKey(
              c.get("agent").id,
              req.key,
              {
                value: req.value,
                secret: req.secret,
                target: req.target,
                updated_at: new Date(),
                updated_by: c.get("user_id"),
              }
            );
            return c.json(convertAgentEnvironmentVariable(envVar));
          }

          return c.json(
            {
              message: `An environment variable with the key "${req.key}" already exists for your provided target(s)`,
            },
            400
          );
        }
        throw err;
      }
    }
  );

  // Delete an environment variable for an agent.
  app.delete(
    "/:env_var_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    withEnvVar,
    async (c) => {
      const db = await c.env.database();
      await db.deleteAgentEnvironmentVariable(c.get("environmentVariable").id);
      return c.body(null, 204);
    }
  );

  // Update an environment variable for an agent.
  app.put(
    "/:env_var_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    withEnvVar,
    validator("json", (value) => {
      return schemaUpdateAgentEnvRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const envVar = c.get("environmentVariable");
      const req = c.req.valid("json");
      try {
        const updated = await db.updateAgentEnvironmentVariable(envVar.id, {
          key: req.key,
          value: req.value,
          secret: req.secret,
          target: req.target,
          updated_at: new Date(),
          updated_by: c.get("user_id"),
        });
        return c.json(convertAgentEnvironmentVariable(updated));
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return c.json(
            {
              message: `An environment variable with the key "${req.key}" already exists for your provided target(s)`,
            },
            400
          );
        }
        throw err;
      }
    }
  );
}

const withEnvVar: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    agent: Agent;
    environmentVariable: DBAgentEnvironmentVariable;
  };
}> = async (c, next) => {
  const id = c.req.param("env_var_id");
  if (!id) {
    return c.json({ message: "Environment variable ID is required" }, 400);
  }
  const parsed = await z.uuid().safeParseAsync(id);
  if (!parsed.success) {
    return c.json({ message: "Invalid environment variable ID" }, 400);
  }
  const db = await c.env.database();
  const envVar = await db.selectAgentEnvironmentVariableByID(id);
  if (!envVar) {
    return c.json({ message: "Environment variable not found" }, 404);
  }
  if (envVar.agent_id !== c.get("agent").id) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  c.set("environmentVariable", envVar);
  await next();
};

const convertAgentEnvironmentVariable = (
  env: DBAgentEnvironmentVariable
): AgentEnvironmentVariable => {
  return {
    id: env.id,
    created_at: env.created_at,
    updated_at: env.updated_at,
    created_by: env.created_by,
    updated_by: env.updated_by,
    key: env.key,
    value: env.secret ? null : env.value,
    secret: env.secret,
    target: env.target as AgentDeploymentTarget[],
  };
};
