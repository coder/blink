import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getQuerier } from "@/lib/database";
import { redirect } from "next/navigation";
import { getAgent, getOrganization, getUser } from "../layout";
import { AgentNavigation } from "./navigation";

export default async function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
  const user = await getUser(session.user.id);

  // Get organization kind from database for navigation
  const db = await getQuerier();
  const dbOrg = await db.selectOrganizationForUser({
    organizationName,
    userID: session.user.id,
  });
  const isPersonalOrg = dbOrg?.kind === "personal";

  return (
    // many tabs, like logs, traces, and chats, depend on the class name below to
    // display their content properly.
    // don't remove it without a thorough review of the dependents.
    <div className="flex flex-col max-h-screen grow">
      <Header user={user} organization={organization} agent={agent} />
      <AgentNavigation
        organization={organization}
        agent={agent}
        isPersonalOrg={isPersonalOrg}
      />
      <div className="flex flex-col flex-1 min-h-0 h-full overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
