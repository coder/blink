import type { AgentPermission as DBAgentPermission } from "@blink.so/database/schema";
import { validator } from "hono/validator";
import { parseOrderBy } from "../../client-helper";
import {
  withAgent,
  withAgentPermission,
  withAuth,
  withPagination,
  withTeamOrganization,
} from "../../middleware";
import type { APIServer } from "../../server";
import {
  schemaGrantAgentPermissionRequestBody,
  type AgentMember,
  type ListAgentMembersResponse,
} from "./members.client";

export default function mountAgentMembers(server: APIServer) {
  // List agent members (permissions)
  server.get(
    "/",
    withAuth,
    withAgent,
    withTeamOrganization,
    withAgentPermission("read"),
    withPagination,
    async (c) => {
      const db = await c.env.database();
      const agent = c.get("agent");
      const orderByParam = c.req.query("order_by");
      const orderBy = parseOrderBy(orderByParam);
      const members = await db.selectAgentPermissions({
        agentId: agent.id,
        page: c.get("page"),
        per_page: c.get("per_page"),
        orderBy: orderBy?.field as "permission" | "name" | "created_at" | undefined,
        orderDirection: orderBy?.direction,
      });
      const resp: ListAgentMembersResponse = {
        has_more: members.has_more,
        items: members.items.map((m) =>
          convertAgentMember({
            permission: m,
            user: m.user,
          })
        ),
      };
      return c.json(resp);
    }
  );

  // Grant or update permission
  server.post(
    "/",
    withAuth,
    withAgent,
    withTeamOrganization,
    withAgentPermission("admin"),
    validator("json", (value) => {
      return schemaGrantAgentPermissionRequestBody.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const agent = c.get("agent");
      const userId = c.get("user_id");
      const { user_id, permission } = c.req.valid("json");

      const updated = await db.upsertAgentPermission({
        agent_id: agent.id,
        user_id: user_id ?? undefined,
        permission,
        created_by: userId,
      });

      let user = null;
      if (updated.user_id) {
        user = await db.selectUserByID(updated.user_id);
      }

      return c.json(
        convertAgentMember({
          permission: updated as unknown as DBAgentPermission & {
            user?: typeof user;
          },
          user: user,
        })
      );
    }
  );

  // Revoke permission
  server.delete(
    "/",
    withAuth,
    withAgent,
    withTeamOrganization,
    withAgentPermission("admin"),
    async (c) => {
      const db = await c.env.database();
      const agent = c.get("agent");
      const user_id = c.req.query("user_id") ?? null;

      await db.deleteAgentPermission({
        agent_id: agent.id,
        user_id: user_id ?? undefined,
      });

      return c.body(null, 204);
    }
  );
}

function convertAgentMember(input: {
  permission: DBAgentPermission;
  user?: {
    id: string;
    created_at: Date;
    updated_at: Date;
    username: string;
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
}): AgentMember {
  return {
    user_id: input.permission.user_id,
    agent_id: input.permission.agent_id,
    permission: input.permission.permission,
    created_at: input.permission.created_at,
    updated_at: input.permission.updated_at,
    created_by: input.permission.created_by,
    user: input.user
      ? {
          id: input.user.id,
          created_at: input.user.created_at,
          updated_at: input.user.updated_at,
          username: input.user.username,
          display_name: input.user.display_name,
          email: input.user.email!,
          avatar_url: input.user.avatar_url,
        }
      : null,
  };
}
