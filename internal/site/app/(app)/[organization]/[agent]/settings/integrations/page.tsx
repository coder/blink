import { notFound, redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { getAgent } from "../../../layout";
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
  const agent = await getAgent(organizationName, agentName);

  const permission = agent.user_permission;
  if (!(permission === "admin" || permission === "write")) {
    return notFound();
  }

  return (
    <div className="space-y-12">
      <IntegrationsManager
        agentId={agent.id}
        agentName={agent.name}
        integrationsState={agent.integrations_state}
      />
    </div>
  );
}
