import { auth } from "@/app/(auth)/auth";
import { getQuerier } from "@/lib/database";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../layout";
import { AgentAccessClient } from "./agent-access-client";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; agent: string }>;
}): Promise<Metadata> {
  const session = await auth();
  const { organization, agent } = await props.params;
  if (!session?.user?.id) {
    return { title: "Blink" };
  }
  const [org, ag] = await Promise.all([
    getOrganization(session.user.id, organization),
    getAgent(organization, agent),
  ]);
  return { title: `Access · ${ag.name} · ${org.name} - Blink` };
}

export default async function AccessPage({
  params,
}: {
  params: Promise<{ organization: string; agent: string }>;
}) {
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }

  const { organization: organizationName, agent: agentName } = await params;
  const [organization, agent] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getAgent(organizationName, agentName),
  ]);

  // Check organization kind from database
  const db = await getQuerier();
  const dbOrg = await db.selectOrganizationForUser({
    organizationName,
    userID: session.user.id,
  });

  // Access management is not available for personal organizations
  if (dbOrg?.kind === "personal") {
    return notFound();
  }

  // Check if user has admin permission for this agent
  if (!agent.user_permission || agent.user_permission !== "admin") {
    return notFound();
  }

  return (
    <AgentAccessClient
      agentId={agent.id}
      organizationId={organization.id}
      agentVisibility={agent.visibility}
      currentUserId={session.user.id}
      organizationName={organization.name}
    />
  );
}
