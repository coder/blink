import type { UserWithPersonalOrganization } from "@blink.so/database/schema";
import { validator } from "hono/validator";
import { withPagination, withSiteAdmin } from "../../middleware";
import type { APIServer } from "../../server";
import {
  type ListSiteUsersResponse,
  type SiteUser,
  schemaListSiteUsersRequest,
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
  };
};
