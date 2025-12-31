import type {
  OrganizationMembership as DBOrganizationMembership,
  UserWithPersonalOrganization,
} from "@blink.so/database/schema";
import { validator } from "hono/validator";
import { parseOrderBy } from "../../client-helper";
import {
  withAuth,
  withOrganizationURLParam,
  withPagination,
} from "../../middleware";
import type { APIServer } from "../../server";
import {
  schemaUpdateOrganizationMemberRequestBody,
  type ListOrganizationMembersResponse,
  type OrganizationMember,
} from "./members.client";

export default function mountMembers(server: APIServer) {
  // List organization members.
  server.get(
    "/",
    withAuth,
    withOrganizationURLParam,
    withPagination,
    async (c) => {
      const db = await c.env.database();
      const query = c.req.query("query");
      const orderByParam = c.req.query("order_by");
      const orderBy = parseOrderBy(orderByParam);
      const members = await db.selectOrganizationMembers({
        organizationID: c.get("organization").id,
        page: c.get("page"),
        per_page: c.get("per_page"),
        query: query || undefined,
        orderBy: orderBy?.field as "role" | "name" | "created_at" | undefined,
        orderDirection: orderBy?.direction,
      });
      const resp: ListOrganizationMembersResponse = {
        has_more: members.has_more,
        items: members.items.map((m) =>
          convertOrganizationMember({
            organization_membership: m,
            user: m.user,
          })
        ),
      };
      return c.json(resp);
    }
  );

  // Update a member's role.
  server.put(
    "/:user_id",
    withAuth,
    withOrganizationURLParam,
    validator("json", (value) => {
      return schemaUpdateOrganizationMemberRequestBody.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const org = c.get("organization");
      const membership = org.membership;

      // Only owners and admins can update roles.
      if (
        !membership ||
        (membership.role !== "owner" && membership.role !== "admin")
      ) {
        return c.json({ message: "Forbidden" }, 403);
      }

      const userId = c.req.param("user_id");
      const { role } = c.req.valid("json");

      const updated = await db.updateOrganizationMembership({
        user_id: userId,
        organization_id: org.id,
        role: role,
      });
      if (!updated) {
        return c.json({ message: "Member not found" }, 404);
      }
      const user = await db.selectUserByID(userId);
      if (!user) {
        return c.json({ message: "User not found" }, 404);
      }
      return c.json(
        convertOrganizationMember({
          organization_membership:
            updated as unknown as DBOrganizationMembership,
          user: user,
        })
      );
    }
  );

  // Remove a member from the organization.
  server.delete("/:user_id", withAuth, withOrganizationURLParam, async (c) => {
    const db = await c.env.database();
    const org = c.get("organization");
    const membership = org.membership;

    // Only owners and admins can remove members.
    if (
      !membership ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      return c.json({ message: "Forbidden" }, 403);
    }

    const userId = c.req.param("user_id");

    await db.deleteOrganizationMembershipByUserIDAndOrganizationID(
      userId,
      org.id
    );
    return c.body(null, 204);
  });

  // Get a member of an organization.
  server.get("/:user_id", withAuth, withOrganizationURLParam, async (c) => {
    const db = await c.env.database();
    const org = c.get("organization");
    const membership = await db.selectOrganizationMembership({
      userID: c.req.param("user_id"),
      organizationID: org.id,
    });
    if (!membership) {
      return c.json({ message: "Member not found" }, 404);
    }
    const user = await db.selectUserByID(membership.user_id);
    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }
    return c.json(
      convertOrganizationMember({
        organization_membership: membership,
        user: user,
      })
    );
  });
}

const convertOrganizationMember = (membership: {
  organization_membership: DBOrganizationMembership;
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
  >;
}): OrganizationMember => {
  return {
    organization_id: membership.organization_membership.organization_id,
    user_id: membership.user.id,
    created_at: membership.organization_membership.created_at,
    updated_at: membership.organization_membership.updated_at,
    role: membership.organization_membership.role,
    user: {
      id: membership.user.id,
      created_at: membership.user.created_at,
      updated_at: membership.user.updated_at,
      display_name: membership.user.display_name,
      email: membership.user.email!,
      avatar_url: membership.user.avatar_url,
      username: membership.user.username,
      organization_id: membership.user.organization_id,
    },
  };
};
