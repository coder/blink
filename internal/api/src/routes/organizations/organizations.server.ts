import * as convert from "@blink.so/database/convert";
import { validator } from "hono/validator";
import { withAuth } from "../../middleware";
import type { APIServer } from "../../server";
import { isUniqueConstraintError } from "../../server-helper";
import mountAgents from "./agents.server";
import mountMembers from "./members.server";
import {
  schemaCreateOrganizationRequest,
  schemaUpdateOrganizationRequest,
} from "./organizations.client";

export default function mountOrganizations(server: APIServer) {
  // List organizations for the user.
  server.get("/", withAuth, async (c) => {
    const db = await c.env.database();
    const organizations = await db.selectOrganizationsForUser({
      userID: c.get("user_id"),
    });
    return c.json(
      organizations.map((org) => convert.organization(c.env.apiBaseURL, org))
    );
  });

  // Create a new organization.
  server.post(
    "/",
    withAuth,
    validator("json", (value, c) => {
      return schemaCreateOrganizationRequest.parse(value);
    }),
    async (c) => {
      if (c.env.enableMultiOrg === false) {
        return c.json(
          { message: "Creating new organizations is disabled" },
          403
        );
      }
      const db = await c.env.database();
      const { name } = c.req.valid("json");
      try {
        const organization = await db.insertOrganizationWithMembership({
          name,
          created_by: c.get("user_id"),
        });
        return c.json(
          convert.organization(c.env.apiBaseURL, organization),
          201
        );
      } catch (error) {
        if (
          isUniqueConstraintError(error, "organization_name_unique") ||
          isUniqueConstraintError(error, "organization_lower_idx")
        ) {
          return c.json({ message: "That name is already taken!" }, 400);
        }
        throw error;
      }
    }
  );

  // Get an organization by ID.
  server.get("/:id", withAuth, async (c) => {
    const db = await c.env.database();
    const organization = await db.selectOrganizationForUser({
      organizationID: c.req.param("id"),
      userID: c.get("user_id"),
    });
    if (!organization) {
      return c.json({ message: "Organization not found" }, 404);
    }
    return c.json(convert.organization(c.env.apiBaseURL, organization));
  });

  // Update an organization by ID.
  server.patch(
    "/:id",
    withAuth,
    validator("json", (value, c) => {
      return schemaUpdateOrganizationRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const organizationID = c.req.param("id");
      const userID = c.get("user_id");
      const { name, avatar_file_id, avatar_url } = c.req.valid("json");

      const organization = await db.selectOrganizationForUser({
        organizationID,
        userID,
      });

      if (!organization) {
        return c.json({ message: "Organization not found" }, 404);
      }

      if (
        !organization.membership ||
        (organization.membership.role !== "admin" &&
          organization.membership.role !== "owner")
      ) {
        return c.json(
          { message: "You must be an admin of the organization to update it" },
          403
        );
      }

      try {
        // Update name if provided
        if (name !== undefined) {
          await db.updateOrganizationByID(organizationID, {
            name: name.trim(),
          });
        }

        // Update avatar if provided
        if (avatar_file_id !== undefined) {
          const newUrl =
            avatar_file_id && avatar_file_id.trim().length > 0
              ? `/api/files/${avatar_file_id.trim()}`
              : null;
          await db.updateOrganizationByID(organizationID, {
            avatar_url: newUrl,
          });
        } else if (avatar_url !== undefined) {
          // Support direct avatar URL (e.g., GitHub avatars)
          await db.updateOrganizationByID(organizationID, { avatar_url });
        }

        // Fetch updated organization
        const updatedOrganization = await db.selectOrganizationForUser({
          organizationID,
          userID,
        });

        if (!updatedOrganization) {
          return c.json(
            { message: "Organization not found after update" },
            404
          );
        }

        return c.json(
          convert.organization(c.env.apiBaseURL, updatedOrganization)
        );
      } catch (error) {
        if (
          isUniqueConstraintError(error, "organization_name_unique") ||
          isUniqueConstraintError(error, "organization_lower_idx")
        ) {
          return c.json({ message: "That name is already taken!" }, 400);
        }
        throw error;
      }
    }
  );

  server.delete("/:id", withAuth, async (c) => {
    if (c.env.enableMultiOrg === false) {
      return c.json({ message: "Deleting organizations is disabled" }, 403);
    }
    const db = await c.env.database();
    const organization = await db.selectOrganizationForUser({
      organizationID: c.req.param("id"),
      userID: c.get("user_id"),
    });
    if (!organization) {
      return c.json({ message: "Organization not found" }, 404);
    }
    if (!organization.membership || organization.membership.role !== "owner") {
      return c.json(
        { message: "You must be an owner of the organization to delete it" },
        403
      );
    }
    await db.deleteOrganization({
      id: organization.id,
    });
    return c.body(null, 204);
  });

  mountMembers(server.basePath("/:organization_id/members"));
  mountAgents(server.basePath("/:organization_id/agents"));
}
