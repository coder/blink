import { auth } from "@/app/(auth)/auth";
import { getQuerier } from "@/lib/database";
import * as convert from "@blink.so/database/convert";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organization: string }>;
}) {
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  return <>{children}</>;
}

export const getOrganization = cache(
  async (userID: string, organizationName: string) => {
    const db = await getQuerier();
    const organization = await db.selectOrganizationForUser({
      organizationName,
      userID,
    });
    if (!organization || !organization.membership) {
      return notFound();
    }
    const baseURL = new URL(
      process.env.NEXT_PUBLIC_BASE_URL! ?? "http://localhost:3000"
    );
    return convert.organization(baseURL, organization);
  }
);

export const getOrganizationByID = cache(
  async (userID: string, organizationID: string) => {
    const db = await getQuerier();
    const organization = await db.selectOrganizationForUser({
      organizationID,
      userID,
    });
    if (!organization || !organization.membership) {
      return notFound();
    }
    const baseURL = new URL(
      process.env.NEXT_PUBLIC_BASE_URL! ?? "http://localhost:3000"
    );
    return convert.organization(baseURL, organization);
  }
);

export const getUser = cache(async (userID: string) => {
  const db = await getQuerier();
  const user = await db.selectUserByID(userID);
  if (!user) {
    return notFound();
  }
  return convert.user(user);
});

export const getAgent = cache(
  async (organizationName: string, agentName: string) => {
    const session = await auth();
    const userID = session?.user?.id;
    const db = await getQuerier();
    const agent = await db.selectAgentByNameForUser({
      organizationName,
      agentName,
      userID,
    });
    if (!agent) {
      return notFound();
    }
    // Get the production deployment target's request_id
    const productionTarget = await db.selectAgentDeploymentTargetByName(
      agent.id,
      "production"
    );
    const requestURL = productionTarget?.request_id
      ? new URL(`https://${productionTarget.request_id}.blink.host/`)
      : undefined;

    // Get user permission for the agent
    let userPermission: "read" | "write" | "admin" | undefined;
    if (userID) {
      const org = await db.selectOrganizationForUser({
        organizationID: agent.organization_id,
        userID,
      });
      // Org owners and admins get admin permission
      if (
        org?.membership &&
        (org.membership.role === "owner" || org.membership.role === "admin")
      ) {
        userPermission = "admin";
      } else {
        userPermission = await db.getAgentPermissionForUser({
          agentId: agent.id,
          userId: userID,
          orgRole: org?.membership?.role,
        });
        // If permission is undefined, user doesn't have access
        if (userPermission === undefined) {
          return notFound();
        }
      }
    }

    return convert.agent(agent, requestURL, userPermission);
  }
);
