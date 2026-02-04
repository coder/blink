import type { UserWithPersonalOrganization } from "@blink.so/database/schema";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import { withPagination, withSiteAdmin } from "../../middleware";
import type { APIServer } from "../../server";
import { hashPassword } from "../../util/password";
import { provisionUser } from "../provision-user";
import {
  type ListSiteUsersResponse,
  type SiteUser,
  schemaAdminChangePasswordRequest,
  schemaCreateUserRequest,
  schemaListSiteUsersRequest,
  schemaUpdateRoleRequest,
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

  // Update user role (site admin only).
  server.patch(
    "/:id/role",
    withSiteAdmin,
    validator("param", (value) => {
      return z.object({ id: z.string().uuid() }).parse(value);
    }),
    validator("json", (value) => {
      return schemaUpdateRoleRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const { id } = c.req.valid("param");
      const { site_role } = c.req.valid("json");
      const currentUserId = c.get("user_id");

      // Prevent changing own role
      if (id === currentUserId) {
        throw new HTTPException(400, {
          message: "Cannot change your own role",
        });
      }

      // Check if user exists
      const existingUser = await db.selectUserByID(id);
      if (!existingUser) {
        throw new HTTPException(404, { message: "User not found" });
      }

      // Update user role
      await db.updateUserByID({ id, site_role });

      // Fetch updated user to return
      const updatedUser = await db.selectUserByID(id);
      if (!updatedUser) {
        throw new HTTPException(404, { message: "User not found" });
      }

      return c.json(convertSiteUser(updatedUser));
    }
  );

  // Change user password (site admin only).
  server.patch(
    "/:id/password",
    withSiteAdmin,
    validator("param", (value) => {
      return z.object({ id: z.string().uuid() }).parse(value);
    }),
    validator("json", (value) => {
      return schemaAdminChangePasswordRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const { id } = c.req.valid("param");
      const { password } = c.req.valid("json");

      const existingUser = await db.selectUserByID(id);
      if (!existingUser) {
        throw new HTTPException(404, { message: "User not found" });
      }

      const hashedPassword = await hashPassword(password);
      await db.updateUserByID({ id, password: hashedPassword });

      const updatedUser = await db.selectUserByID(id);
      if (!updatedUser) {
        throw new HTTPException(404, { message: "User not found" });
      }

      return c.json(convertSiteUser(updatedUser));
    }
  );

  // Create a new user (site admin only).
  server.post(
    "/",
    withSiteAdmin,
    validator("json", (value) => {
      return schemaCreateUserRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const { email, password, display_name, site_role } = c.req.valid("json");

      // Check if user with email already exists
      const existingUser = await db.selectUserByEmail(email);
      if (existingUser) {
        throw new HTTPException(409, {
          message: "User with this email already exists",
        });
      }

      const hashedPassword = await hashPassword(password);

      const newUser = await provisionUser({
        db,
        autoJoinOrganizations: c.env.autoJoinOrganizations,
        user: {
          email,
          password: hashedPassword,
          display_name: display_name ?? null,
          email_verified: new Date(), // Admin-created users are pre-verified
          site_role,
        },
      });

      return c.json(convertSiteUser(newUser), 201);
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
