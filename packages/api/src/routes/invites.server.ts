import type {
  OrganizationInvite as DBOrganizationInvite,
  OrganizationMembership as DBOrganizationMembership,
} from "@blink.so/database/schema";
import type { MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import {
  authorizeOrganization,
  withAuth,
  withOrganizationIDQueryParam,
} from "../middleware";
import type { APIServer, Bindings } from "../server";
import {
  schemaAcceptOrganizationInviteRequestBody,
  schemaCreateOrganizationInviteRequest,
  type OrganizationInvite,
  type OrganizationInviteWithCode,
} from "./invites.client";
import type { OrganizationMembership } from "./organizations/members.client";

export default function mountInvites(server: APIServer) {
  // List invites for an organization.
  server.get("/", withAuth, withOrganizationIDQueryParam, async (c) => {
    const db = await c.env.database();
    const org = c.get("organization");
    const invites = await db.selectOrganizationInvitesByOrganizationID(org.id);
    return c.json(invites.map(convertInviteWithCode));
  });

  // Create an invite for an organization.
  server.post(
    "/",
    withAuth,
    validator("json", (value, c) => {
      return schemaCreateOrganizationInviteRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const req = c.req.valid("json");
      const organization = await authorizeOrganization(c, req.organization_id);

      // Only owners and admins can create invites.
      if (
        !organization.membership ||
        (organization.membership.role !== "owner" &&
          organization.membership.role !== "admin")
      ) {
        return c.json({ message: "Forbidden" }, 403);
      }

      const invite = await db.insertOrganizationInvite({
        organization_id: organization.id,
        email: req.email,
        role: req.role,
        invited_by: c.get("user_id"),
        reusable: req.reusable,
      });

      // Sync invited user to telemetry system (async, don't block)
      if (c.env.sendTelemetryEvent && invite.email) {
        db.selectOrganizationByID(organization.id)
          .then((org) => {
            if (!invite.email || !c.env.sendTelemetryEvent) return;
            return c.env.sendTelemetryEvent({
              type: "user.invited",
              email: invite.email,
            });
          })
          .catch(() => {
            // Ignore errors to avoid breaking invite creation
          });
      }

      // Trigger email notification for non-reusable invites
      if (!req.reusable && req.email && c.env.sendEmail) {
        try {
          const [inviter, org] = await Promise.all([
            db.selectUserByID(c.get("user_id")),
            db.selectOrganizationByID(organization.id),
          ]);

          if (inviter && org) {
            const baseUrl = c.env.apiBaseURL.origin;
            await c.env.sendEmail({
              type: "invite",
              email: req.email,
              inviterName:
                inviter.display_name || inviter.username || "Someone",
              inviterEmail: inviter.email || "",
              teamName: org.name,
              role: req.role,
              inviteUrl: `${baseUrl}/invite/${invite.code}`,
            });
          }
        } catch (error) {
          console.error("Failed to send invite email:", error);
          // Don't fail the request if email fails
        }
      }

      const inviteWithCode: OrganizationInviteWithCode = {
        ...convertInvite(invite),
        code: invite.code,
      };

      return c.json(inviteWithCode, 201);
    }
  );

  // Delete an invite for an organization.
  server.delete("/:invite_id", withAuth, withInviteIDParam, async (c) => {
    const db = await c.env.database();
    const invite = c.get("invite");
    const org = await authorizeOrganization(c, invite.organization_id);
    // Only the user who created the invite or owners and admins can delete it.
    if (
      invite.invited_by !== c.get("user_id") &&
      (!org.membership ||
        (org.membership.role !== "owner" && org.membership.role !== "admin"))
    ) {
      return c.json({ message: "Forbidden" }, 403);
    }
    await db.deleteOrganizationInvite(invite.id);
    return c.body(null, 204);
  });

  // Accept an invite for the authenticated user.
  server.post(
    "/:invite_id/accept",
    withAuth,
    withInviteIDParam,
    validator("json", (value, c) => {
      return schemaAcceptOrganizationInviteRequestBody.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const invite = c.get("invite");
      const req = c.req.valid("json");

      // First check if the invite is expired.
      if (invite.expires_at && new Date() > invite.expires_at) {
        return c.json({ message: "Invite has expired" }, 400);
      }

      // Check if the invite has already been accepted, and is not reusable.
      if (invite.last_accepted_at && !invite.reusable) {
        return c.json({ message: "Invite has already been used" }, 400);
      }

      // Check if the code is correct.
      if (invite.code !== req.code) {
        return c.json({ message: "Invalid code" }, 400);
      }

      const userId = c.get("user_id");

      const membership = await db.tx(async (tx) => {
        const membership = await tx.insertOrganizationMembership({
          organization_id: invite.organization_id,
          user_id: userId,
          role: invite.role,
        });
        await tx.updateOrganizationInvite(invite.id, {
          last_accepted_at: new Date(),
        });
        return membership;
      });

      return c.json(convertOrganizationMembership(membership), 201);
    }
  );
}

const withInviteIDParam: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    invite_id: string;
    invite: DBOrganizationInvite;
  };
}> = async (c, next) => {
  const inviteID = c.req.param("invite_id");
  if (!inviteID) {
    return c.json({ message: "Invite ID is required" }, 400);
  }
  const parsed = await z.uuid().safeParseAsync(inviteID);
  if (!parsed.success) {
    return c.json({ message: "Invalid invite ID" }, 400);
  }
  const db = await c.env.database();
  const invite = await db.selectOrganizationInviteByID(parsed.data);
  if (!invite) {
    return c.json({ message: "Invite not found" }, 404);
  }
  c.set("invite", invite);
  await next();
};

const convertInvite = (invite: DBOrganizationInvite): OrganizationInvite => {
  return {
    id: invite.id,
    organization_id: invite.organization_id,
    email: invite.email!,
    role: invite.role,
    invited_by: invite.invited_by,
    expires_at: invite.expires_at!,
    created_at: invite.created_at,
    updated_at: invite.updated_at,
    accepted_at: invite.last_accepted_at ?? null,
    reusable: invite.reusable,
  };
};

const convertInviteWithCode = (
  invite: DBOrganizationInvite
): OrganizationInviteWithCode => {
  return {
    ...convertInvite(invite),
    code: invite.code,
  };
};

const convertOrganizationMembership = (
  membership: DBOrganizationMembership
): OrganizationMembership => {
  return {
    organization_id: membership.organization_id,
    user_id: membership.user_id,
    role: membership.role,
    created_at: membership.created_at,
    updated_at: membership.updated_at,
  };
};
