import type Querier from "@blink.so/database/querier";

type InsertUserInput = Parameters<Querier["insertUser"]>[0];

export type ProvisionUserOptions = {
  db: Querier;
  autoJoinOrganizations?: boolean;
  user: Omit<InsertUserInput, "site_role"> & {
    site_role?: InsertUserInput["site_role"];
  };
};

export const provisionUser = async ({
  db,
  autoJoinOrganizations,
  user,
}: ProvisionUserOptions) => {
  let isFirstUser = false;
  let teamOrgs: Awaited<ReturnType<typeof db.selectTeamOrganizations>> | null =
    null;

  if (autoJoinOrganizations) {
    teamOrgs = await db.selectTeamOrganizations();
    isFirstUser = teamOrgs.length === 0;
  }

  const { site_role: siteRoleOverride, ...userValues } = user;
  const siteRole = siteRoleOverride ?? (isFirstUser ? "admin" : "member");

  const createdUser = await db.insertUser({
    ...userValues,
    site_role: siteRole,
  });

  if (autoJoinOrganizations && teamOrgs) {
    if (isFirstUser) {
      await db.insertOrganizationWithMembership({
        name: "default",
        kind: "organization",
        created_by: createdUser.id,
      });
    } else {
      for (const org of teamOrgs) {
        await db.insertOrganizationMembership({
          organization_id: org.id,
          user_id: createdUser.id,
          role: "member",
        });
      }
    }
  }

  return createdUser;
};
