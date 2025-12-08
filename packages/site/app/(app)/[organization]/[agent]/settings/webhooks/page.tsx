import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../../layout";
import { WebhooksSection } from "./webhooks-section";

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
  return { title: `Webhooks · ${ag.name} · ${org.name} - Blink` };
}

export default async function WebhooksPage({
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

  // Check if user has write or admin permission for this agent
  const permission = agent.user_permission ?? "read";
  if (permission !== "write" && permission !== "admin") {
    return notFound();
  }

  return (
    <div className="space-y-8">
      <WebhooksSection
        agent={agent}
        organizationName={organizationName}
        agentName={agentName}
      />
    </div>
  );
}
