import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { getAgent } from "../../layout";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; agent: string }>;
}): Promise<Metadata> {
  const session = await auth();
  const { organization, agent } = await props.params;
  if (!session?.user?.id) {
    return { title: "Blink" };
  }
  const ag = await getAgent(organization, agent);
  return { title: `Develop · ${ag.name} · ${organization} - Blink` };
}

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string; agent: string }>;
}) {
  const { organization: organizationName, agent: agentName } = await params;
  const agent = await getAgent(organizationName, agentName);

  return <div>{agent.name}</div>;
}
