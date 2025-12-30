import { auth } from "@/app/(auth)/auth";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getQuerier } from "@/lib/database";
import { Clock, Globe, Lock } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, getOrganization } from "../layout";
import AgentDailyChats from "./components/agent-daily-chats";
// import AgentReadme from "./components/agent-readme";
// import RecentSteps from "./recent-steps";
import AgentPinned from "@/components/agent-pinned";
import type { Metadata } from "next";

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
  return { title: `${ag.name} · ${org.name} - Blink` };
}

function formatTimeAgo(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string; agent: string }>;
}) {
  const { organization: organizationName, agent: agentName } = await params;
  const db = await getQuerier();
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const [organization, agent] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getAgent(organizationName, agentName),
  ]);

  const [latestDeployment, stats, creator] = await Promise.all([
    db.selectAgentDeploymentByIDOrActive({
      agentID: agent.id,
    }),
    db.selectAgentDailyChats({
      agentID: agent.id,
    }),
    db.selectUserByID(agent.created_by),
  ]);

  // const readmeFileID = latestDeployment?.source_files?.find(
  //   (file) => file.path === "README.md"
  // )?.id;

  // const baseURL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  //   ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  //   : "http://localhost:3000";

  // let readmeContent: string | undefined;
  // if (readmeFileID) {
  //   const res = await fetch(`${baseURL}/api/files/${readmeFileID}`);
  //   readmeContent = await res.text();
  // }

  // const defaultReadmeMessage =
  //   "This agent does not have a README. Add a README to your agent so that users know how to use your agent.";
  // if (!readmeContent || readmeContent.trim().length === 0) {
  //   readmeContent = defaultReadmeMessage;
  // }

  return (
    <div className="flex flex-col flex-1 w-full items-center">
      <div className="p-8 w-full max-w-5xl space-y-8 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-8 border-b border-border">
          <div className="flex gap-4">
            <Avatar
              className="w-10 h-10 mt-1.5"
              seed={agent.id}
              src={agent.avatar_url}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-medium">{agent.name}</h1>
                <Badge variant="secondary" className="gap-1.5">
                  {agent.visibility === "public" ? (
                    <Globe className="h-3 w-3" />
                  ) : (
                    <Lock className="h-3 w-3" />
                  )}
                  <span className="capitalize">{agent.visibility}</span>
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                <span>Last updated {formatTimeAgo(agent.updated_at)}</span>
              </div>
              {agent.description && (
                <p className="text-muted-foreground mt-2">
                  {agent.description}
                </p>
              )}
            </div>
          </div>
          <div>
            <AgentPinned agentID={agent.id} pinned={agent.pinned} />
          </div>
        </div>

        <div className="flex w-full flex-col md:flex-row gap-8">
          <div className="w-full md:basis-[70%]">
            {/* README section - keeping layout space empty for now */}
          </div>

          <div className="w-full md:basis-[30%] gap-8 flex flex-col">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Get Started
              </div>
              <Button variant="secondary" className="w-full" asChild>
                <Link href={`/${organizationName}/${agentName}/chats`}>
                  Create a Chat
                </Link>
              </Button>
            </div>

            <AgentDailyChats data={stats} />

            {creator && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  Collaborators
                </div>
                <div className="flex items-center gap-3">
                  <Avatar
                    className="w-10 h-10"
                    seed={creator?.organization_id ?? ""}
                    src={creator?.avatar_url}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
