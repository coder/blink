import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../layout";
import SourceView from "./view";

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
  return { title: `Source · ${ag.name} · ${org.name} - Blink` };
}

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string; agent: string }>;
}) {
  const { organization: organizationName, agent: agentName } = await params;
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const [organization, agent] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getAgent(organizationName, agentName),
  ]);

  return (
    <div className="h-full w-full overflow-hidden">
      <SourceView
        agentId={agent.id}
        deploymentId={agent.active_deployment_id}
      />
    </div>
  );
}
