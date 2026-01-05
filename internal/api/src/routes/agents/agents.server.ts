import * as convert from "@blink.so/database/convert";
import type { Agent } from "@blink.so/database/schema";
import { Client } from "blink/client";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { streamSSE } from "../../client-helper";
import {
  authorizeOrganization,
  withAgentPermission,
  withAgentURLParam,
  withAuth,
  withPagination,
} from "../../middleware";
import type { Bindings } from "../../server";
import { isUniqueConstraintError } from "../../server-helper";
import {
  schemaAgentCompletionRequest,
  schemaAgentCompletionResponse,
  schemaAgentRuntimeUsageRequest,
  schemaCreateAgentRequest,
  schemaUpdateAgentRequest,
  type ListAgentsResponse,
} from "./agents.client";
import mountDeployments, { createAgentDeployment } from "./deployments.server";
import mountEnv from "./env.server";
import mountLogs from "./logs.server";
import mountAgentsMe from "./me/me.server";
import mountAgentMembers from "./members.server";
import mountRuns from "./runs.server";
import mountSetupGitHub from "./setup-github.server";
import mountSetupSlack from "./setup-slack.server";
import mountSteps from "./steps.server";
import mountTraces from "./traces.server";

export default function mountAgents(app: Hono<{ Bindings: Bindings }>) {
  // Create an agent.
  app.post(
    "/",
    withAuth,
    validator("json", (value, c) => {
      return schemaCreateAgentRequest.parse(value);
    }),
    async (c) => {
      const req = c.req.valid("json");
      const org = await authorizeOrganization(c, req.organization_id);
      const db = await c.env.database();
      try {
        const agent = await db.tx(async (tx) => {
          const agent = await tx.insertAgent({
            organization_id: org.id,
            created_by: c.get("user_id"),
            name: req.name,
            description: req.description,
            visibility: req.visibility ?? "organization",
            chat_expire_ttl: req.chat_expire_ttl,
            onboarding_state: req.onboarding_state,
          });

          // Grant admin permission to the creator
          await tx.upsertAgentPermission({
            agent_id: agent.id,
            user_id: agent.created_by,
            permission: "admin",
            created_by: agent.created_by,
          });

          // If a request_id was specified, update the production deployment target
          if (req.request_id) {
            const productionTarget = await tx.selectAgentDeploymentTargetByName(
              agent.id,
              "production"
            );
            if (productionTarget) {
              await tx.updateAgentDeploymentTarget(productionTarget.id, {
                request_id: req.request_id,
              });
            }
          }

          if (req.env) {
            for (const env of req.env) {
              await tx.insertAgentEnvironmentVariable({
                agent_id: agent.id,
                key: env.key,
                value: env.value,
                secret: env.secret,
                // By default, insert for both preview and production.
                target: env.target ?? ["preview", "production"],
                created_by: c.get("user_id"),
                updated_by: c.get("user_id"),
              });
            }
          }

          if (req.output_files || req.source_files) {
            // Since the target is production, this will be the active
            // deployment for the agent assuming the build is successful.
            await createAgentDeployment({
              req: c.req.raw,
              db: tx,
              bindings: c.env,
              outputFiles: req.output_files,
              sourceFiles: req.source_files,
              entrypoint: req.entrypoint,
              agentID: agent.id,
              userID: c.get("user_id"),
              organizationID: org.id,
              target: "production",
            });
          }

          return agent;
        });
        return c.json(
          convert.agent(agent, await createAgentRequestURL(c, agent), "admin")
        );
      } catch (error) {
        if (isUniqueConstraintError(error, "agent_organization_id_lower_idx")) {
          return c.json({ error: "That name is already taken!" }, 400);
        }
        throw error;
      }
    }
  );

  // List agents for the current user.
  // Optionally, filter by organization ID.
  app.get("/", withAuth, withPagination, async (c) => {
    const orgParam = c.req.query("organization_id");
    const db = await c.env.database();
    if (orgParam) {
      await authorizeOrganization(c, orgParam);
    }

    let pinned: boolean | undefined;
    if (c.req.query("pinned")) {
      if (c.req.query("pinned") === "true") {
        pinned = true;
      } else if (c.req.query("pinned") === "false") {
        pinned = false;
      }
    }

    const agents = await db.selectAgentsForUser({
      userID: c.get("user_id"),
      organizationID: orgParam,
      pinned,
      page: c.get("page"),
      per_page: c.get("per_page"),
    });

    const response: ListAgentsResponse = {
      items: await Promise.all(
        agents.items.map(async (agent) =>
          convert.agent(
            agent,
            await createAgentRequestURL(c, agent),
            await getAgentUserPermission(c, agent)
          )
        )
      ),
      has_more: agents.has_more,
    };
    return c.json(response);
  });

  // Get an agent.
  app.get(
    "/:agent_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      const agent = c.get("agent");
      return c.json(
        convert.agent(
          agent,
          await createAgentRequestURL(c, agent),
          await getAgentUserPermission(c, agent)
        )
      );
    }
  );

  // Update an agent.
  app.patch(
    "/:agent_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("json", (value) => {
      return schemaUpdateAgentRequest.parse(value);
    }),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();
      const req = c.req.valid("json");

      // Changing visibility requires admin permission
      if (req.visibility !== undefined && req.visibility !== agent.visibility) {
        const permission = c.get("agent_permission");
        if (permission !== "admin") {
          throw new HTTPException(403, {
            message:
              "Changing agent visibility requires admin permission. You have " +
              permission +
              " permission.",
          });
        }
      }

      try {
        const updated = await db.updateAgent({
          id: agent.id,
          name: req.name,
          description: req.description,
          visibility: req.visibility,
          active_deployment_id: req.active_deployment_id,
          avatar_file_id: req.avatar_file_id,
          chat_expire_ttl: req.chat_expire_ttl,
        });
        return c.json(
          convert.agent(
            updated,
            await createAgentRequestURL(c, updated),
            await getAgentUserPermission(c, updated)
          )
        );
      } catch (error) {
        if (isUniqueConstraintError(error, "agent_organization_id_lower_idx")) {
          return c.json({ error: "That name is already taken!" }, 400);
        }
        throw error;
      }
    }
  );

  // Pin an agent.
  app.post("/:agent_id/pin", withAuth, withAgentURLParam, async (c) => {
    const agent = c.get("agent");
    const db = await c.env.database();
    try {
      await db.insertAgentPin({
        agent_id: agent.id,
        user_id: c.get("user_id"),
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) {
        throw err;
      }
    }
    return c.body(null, 204);
  });

  // Unpin an agent.
  app.delete("/:agent_id/pin", withAuth, withAgentURLParam, async (c) => {
    const agent = c.get("agent");
    const db = await c.env.database();
    await db.deleteAgentPin({ agentID: agent.id, userID: c.get("user_id") });
    return c.body(null, 204);
  });

  // Update onboarding state for an agent.
  app.patch(
    "/:agent_id/onboarding",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();
      const body = await c.req.json();

      // Merge the new state with existing state
      const currentState = agent.onboarding_state ?? { currentStep: "welcome" };
      const newState = { ...currentState, ...body };

      const updated = await db.updateAgent({
        id: agent.id,
        onboarding_state: newState,
      });
      return c.json(
        convert.agent(
          updated,
          await createAgentRequestURL(c, updated),
          await getAgentUserPermission(c, updated)
        )
      );
    }
  );

  // Clear onboarding state for an agent (mark onboarding complete).
  app.delete(
    "/:agent_id/onboarding",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();

      if (agent.onboarding_state) {
        await db.updateAgent({
          id: agent.id,
          onboarding_state: {
            finished: true,
            currentStep: agent.onboarding_state.currentStep,
          },
        });
      }
      return c.body(null, 204);
    }
  );

  // Update integrations state for an agent.
  app.patch(
    "/:agent_id/integrations",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();
      const body = await c.req.json();

      // Merge the new state with existing state
      const currentState = agent.integrations_state ?? {};
      const newState = { ...currentState, ...body };

      const updated = await db.updateAgent({
        id: agent.id,
        integrations_state: newState,
      });
      return c.json(
        convert.agent(
          updated,
          await createAgentRequestURL(c, updated),
          await getAgentUserPermission(c, updated)
        )
      );
    }
  );

  // Delete an agent.
  app.delete(
    "/:agent_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("admin"),
    async (c) => {
      const agent = c.get("agent");
      const db = await c.env.database();
      await db.deleteAgent({ id: agent.id });
      return c.body(null, 204);
    }
  );

  // Get input completions for an agent.
  app.post(
    "/:agent_id/completions",
    withAuth,
    withAgentURLParam,
    validator("json", (value) => {
      return schemaAgentCompletionRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const req = c.req.valid("json");
      const deployment = await db.selectAgentDeploymentByIDOrActive({
        agentID: req.agent_id,
        id: req.agent_deployment_id,
      });
      if (!deployment) {
        return c.json({ error: "Deployment not found" }, 404);
      }
      // Perform a fetch to the URL.
      if (!deployment.direct_access_url) {
        return c.json({ error: "Deployment is not ready" }, 503);
      }
      const url = new URL("/_agent/completions", deployment.direct_access_url);
      const resp = await fetch(url, {
        method: "POST",
        body: JSON.stringify({
          input: req.input,
          caret: req.caret,
          selection: req.selection,
        }),
      });
      if (!resp.ok) {
        return c.json({ error: "Failed to get completions" }, 500);
      }
      if (resp.headers.get("content-type") === "application/json") {
        const body = await resp.json();
        return c.json(body);
      } else if (resp.headers.get("content-type") !== "text/event-stream") {
        return c.json({ error: "Unexpected content type" }, 500);
      }
      return new Response(streamSSE(resp, schemaAgentCompletionResponse), {
        headers: {
          "Content-Type": "text/event-stream",
        },
      });
    }
  );

  // Get the options schema for an agent.
  app.get("/:agent_id/ui-options", withAuth, withAgentURLParam, async (c) => {
    const agent = c.get("agent");
    const deploymentID = c.req.query("agent_deployment_id");
    const db = await c.env.database();
    const deployment = await db.selectAgentDeploymentByIDOrActive({
      agentID: agent.id,
      id: deploymentID,
    });
    if (!deployment) {
      return c.json({ error: "Deployment not found" }, 404);
    }
    // Perform a fetch to the URL.
    if (!deployment.direct_access_url) {
      return c.json({ error: "Deployment is not ready" }, 503);
    }

    const selectedRaw = c.req.query("selected");
    let selected: Record<string, string> | undefined;
    if (selectedRaw) {
      try {
        selected = JSON.parse(selectedRaw);
      } catch (error) {
        return c.json({ error: "Invalid selected options" }, 400);
      }
    }

    // Build an input that uniquely determines the response for caching.
    const etagInput = {
      agent_id: agent.id,
      agent_deployment_id: deployment.id,
      selected,
      // Tie to user/org access in case permissions change response shape.
      user_id: c.get("user_id"),
      organization_id: c.get("organization").id,
      // Also include a stable identifier for the deployment content.
      deployment_updated_at: deployment.updated_at,
    };
    const etag = await computeETag(etagInput);
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch && (ifNoneMatch === `W/${etag}` || ifNoneMatch === etag)) {
      return c.body(null, 304, {
        ETag: etag,
        // This caches based on the deployment context, so it's safe to keep
        // for a while. With consistent inputs, it's safe to assume we
        // should expect consistent responses.
        "Cache-Control": "private, max-age=600, stale-while-revalidate=120",
        // Vary on these request headers since they affect auth and conditional.
        Vary: "Authorization, Cookie",
      });
    }

    const client = new Client({
      baseUrl: deployment.direct_access_url,
    });
    const resp = await client.ui({
      selectedOptions: selected,
    });
    return c.json(resp, 200, {
      ETag: etag,
      // Private cache with revalidation; downstream can use conditional requests.
      "Cache-Control": "private, max-age=0, must-revalidate",
      Vary: "Authorization, Cookie",
    });
  });

  // Get runtime usage for an agent.
  app.get(
    "/:agent_id/usage/runtime",
    withAuth,
    withAgentURLParam,
    validator("query", (value, c) => {
      const agent = c.get("agent");
      return schemaAgentRuntimeUsageRequest.parse({
        agent_id: agent.id,
        start_time: value["start_time"],
        end_time: value["end_time"],
      });
    }),
    async (c) => {
      const validated = c.req.valid("query");
      const seconds = await c.env.runtime.usage({
        agent_id: validated.agent_id,
        start_time: validated.start_time,
        end_time: validated.end_time,
      });
      return c.json({ seconds });
    }
  );

  mountDeployments(app.basePath("/:agent_id/deployments"));
  mountEnv(app.basePath("/:agent_id/env"));
  mountSteps(app.basePath("/:agent_id/steps"));
  mountRuns(app.basePath("/:agent_id/runs"));
  mountLogs(app.basePath("/:agent_id/logs"));
  mountTraces(app.basePath("/:agent_id/traces"));
  mountAgentMembers(app.basePath("/:agent_id/members"));
  mountSetupGitHub(app.basePath("/:agent_id/setup/github"));
  mountSetupSlack(app.basePath("/:agent_id/setup/slack"));

  // This is special - just for the agent invocation API.
  // We don't like to do this, but we do because this API
  // should be fully managed by us, for now.
  mountAgentsMe(app.basePath("/me"));
}

export const createAgentRequestURL = async (
  c: Context<{ Bindings: Bindings; Variables: any }>,
  agent: Agent
): Promise<URL | undefined> => {
  if (!c.env.createRequestURL) {
    return;
  }
  // Get the production deployment target's request_id
  const db = await c.env.database();
  const target = await db.selectAgentDeploymentTargetByName(
    agent.id,
    "production"
  );
  if (!target) {
    return;
  }
  return c.env.createRequestURL(target.request_id);
};

/**
 * Get the user's permission level for an agent
 */
export const getAgentUserPermission = async (
  c: Context<{ Bindings: Bindings; Variables: any }>,
  agent: Agent
): Promise<"read" | "write" | "admin"> => {
  const db = await c.env.database();
  const org = await db.selectOrganizationForUser({
    organizationID: agent.organization_id,
    userID: c.get("user_id"),
  });

  const permission = await db.getAgentPermissionForUser({
    agentId: agent.id,
    userId: c.get("user_id"),
    orgRole: org?.membership?.role,
    agentVisibility: agent.visibility,
  });

  if (permission === undefined) {
    throw new HTTPException(403, {
      message: "You don't have permission to access this agent",
    });
  }

  return permission;
};

// Compute a stable strong ETag for a given input payload.
async function computeETag(payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-1", data);
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i]!.toString(16).padStart(2, "0");
    hex += h;
  }
  return `"${hex}"`;
}
