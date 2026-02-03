import Client from "@blink.so/api";
import * as convert from "@blink.so/database/convert";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth, getSessionToken } from "@/app/(auth)/auth";
import { getQuerier } from "@/lib/database";

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
      process.env.NEXT_PUBLIC_BASE_URL! ?? "http://localhost:3005"
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
      process.env.NEXT_PUBLIC_BASE_URL! ?? "http://localhost:3005"
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
    const agent = await getAgentOrNull(organizationName, agentName);
    if (!agent) {
      return notFound();
    }
    return agent;
  }
);

export const getAgentOrNull = cache(
  async (organizationName: string, agentName: string) => {
    const session = await auth();
    const token = await getSessionToken();
    const baseURL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3005";
    const client = new Client({
      baseURL,
      authToken: token,
    });
    const userID = session?.user?.id;
    const db = await getQuerier();
    const agentFromDB = await db.selectAgentByNameForUser({
      organizationName,
      agentName,
      userID,
    });
    if (!agentFromDB) {
      return null;
    }
    const agent = await client.agents.get(agentFromDB.id);
    if (!agent) {
      return null;
    }
    return agent;
  }
);
