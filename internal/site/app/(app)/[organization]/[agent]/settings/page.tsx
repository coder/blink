import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../layout";
import { AgentDeleteForm } from "./agent-delete-form";
import { AgentSettingsForm } from "./form";

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
  return { title: `Settings · ${ag.name} · ${org.name} - Blink` };
}

export default async function SettingsPage({
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

  // Check if user has admin permission for this agent
  if (!agent.user_permission || agent.user_permission !== "admin") {
    return notFound();
  }

  return (
    <div className="space-y-8">
      <AgentSettingsForm
        agent={agent}
        organizationName={organizationName}
        agentName={agentName}
      />
      <AgentDeleteForm
        agentId={agent.id}
        agentName={agent.name}
        organizationName={organizationName}
      />
    </div>
  );
}
