import type { UserWithPersonalOrganization } from "@blink.so/database/schema";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import { withPagination, withSiteAdmin } from "../../middleware";
import type { APIServer } from "../../server";
import {
  type ListSiteUsersResponse,
  type SiteUser,
  schemaListSiteUsersRequest,
  schemaUpdateSuspensionRequest,
} from "./users.client";

export default function mountAdminUsers(server: APIServer) {
  // List all users (site admin only).
  server.get(
    "/",
    withSiteAdmin,
    withPagination,
    validator("query", (value) => {
      return schemaListSiteUsersRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const { query, site_role } = c.req.valid("query");

      const users = await db.selectAllUsers({
        page: c.get("page"),
        per_page: c.get("per_page"),
        query: query || undefined,
        siteRole: site_role || undefined,
      });

      const resp: ListSiteUsersResponse = {
        has_more: users.has_more,
        items: users.items.map((u) => convertSiteUser(u)),
      };
      return c.json(resp);
    }
  );

  // Update user suspension status (site admin only).
  server.patch(
    "/:id/suspension",
    withSiteAdmin,
    validator("param", (value) => {
      return z.object({ id: z.string().uuid() }).parse(value);
    }),
    validator("json", (value) => {
      return schemaUpdateSuspensionRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const { id } = c.req.valid("param");
      const { suspended } = c.req.valid("json");
      const currentUserId = c.get("user_id");

      // Prevent self-suspension
      if (id === currentUserId) {
        throw new HTTPException(400, {
          message: "Cannot suspend your own account",
        });
      }

      // Check if user exists
      const existingUser = await db.selectUserByID(id);
      if (!existingUser) {
        throw new HTTPException(404, { message: "User not found" });
      }

      // Update user suspension status
      await db.updateUserByID({ id, suspended });

      // Fetch updated user to return
      const updatedUser = await db.selectUserByID(id);
      if (!updatedUser) {
        throw new HTTPException(404, { message: "User not found" });
      }

      return c.json(convertSiteUser(updatedUser));
    }
  );
}

const convertSiteUser = (
  user: Pick<
    UserWithPersonalOrganization,
    | "id"
    | "created_at"
    | "updated_at"
    | "display_name"
    | "email"
    | "avatar_url"
    | "username"
    | "organization_id"
    | "site_role"
    | "suspended"
  >
): SiteUser => {
  return {
    id: user.id,
    created_at: user.created_at,
    updated_at: user.updated_at,
    display_name: user.display_name,
    email: user.email ?? "",
    avatar_url: user.avatar_url,
    username: user.username,
    organization_id: user.organization_id,
    site_role: user.site_role,
    suspended: user.suspended,
  };
};
