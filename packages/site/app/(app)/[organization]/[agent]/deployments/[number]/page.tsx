import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../../layout";
import DeploymentDetailClient from "./view";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; agent: string; number: string }>;
}): Promise<Metadata> {
  const session = await auth();
  const { organization, agent, number } = await props.params;
  if (!session?.user?.id) {
    return { title: "Blink" };
  }
  const [org, ag] = await Promise.all([
    getOrganization(session.user.id, organization),
    getAgent(organization, agent),
  ]);
  return { title: `Deployment #${number} · ${ag.name} · ${org.name} - Blink` };
}

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string; agent: string; number: string }>;
}) {
  const {
    organization: organizationName,
    agent: agentName,
    number,
  } = await params;
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const [organization, agent] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getAgent(organizationName, agentName),
  ]);

  return (
    <div className="flex flex-col flex-1">
      <DeploymentDetailClient
        agentId={agent.id}
        agentName={agent.name}
        deploymentNumber={Number(number)}
        organizationId={organization.id}
        organizationName={organizationName}
        agentSlug={agentName}
      />
    </div>
  );
}
