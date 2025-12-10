import { auth } from "@/app/(auth)/auth";
import { notFound, redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../../layout";
import IntegrationsManager from "./integrations-manager";

export default async function IntegrationsSettingsPage({
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
  const permission = agent.user_permission ?? "read";
  if (permission !== "admin") {
    return notFound();
  }

  return (
    <div className="space-y-12">
      <IntegrationsManager
        agentId={agent.id}
        agentName={agent.name}
        organizationId={organization.id}
      />
    </div>
  );
}
