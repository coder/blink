import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getAgentOrNull, getOrganization, getUser } from "../../../layout";
import { OrganizationNavigation } from "../../../navigation";
import { AgentOnboardingWizard } from "./wizard";

export const metadata: Metadata = {
  title: "Setup - Blink",
};

export default async function AgentOnboardingPage({
  params,
}: {
  params: Promise<{ organization: string; agent: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return redirect("/login");
  }

  const { organization: organizationName, agent: agentName } = await params;
  const [organization, agent] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getAgentOrNull(organizationName, agentName),
  ]);
  const user = await getUser(session.user.id);

  // If agent exists but is not in onboarding, redirect to agent page
  if (agent && agent.onboarding_state?.finished !== false) {
    return redirect(`/${organizationName}/${agentName}`);
  }

  const isPersonal = organization.id === user.organization_id;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <Header user={user} organization={organization} />
      <OrganizationNavigation
        name={organization.name}
        isPersonal={isPersonal}
      />
      <div className="flex-1 overflow-auto">
        <AgentOnboardingWizard
          organizationId={organization.id}
          organizationName={organizationName}
          agentName={agentName}
          agent={
            agent?.onboarding_state
              ? {
                  id: agent.id,
                  name: agent.name,
                  onboarding_state: agent.onboarding_state,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
