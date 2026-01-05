import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { PlusIcon } from "@/components/icons";
import { AreaChart } from "@/components/ui/area-chart";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getQuerier } from "@/lib/database";
import { Bot } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrganization, getUser } from "./layout";
import { OrganizationNavigation } from "./navigation";

async function LastUpdatedBy({ userId }: { userId: string | null }) {
  if (!userId) return null;
  const db = await getQuerier();
  try {
    const user = await db.selectUserByID(userId);
    if (!user) return null;
    return (
      <span
        className="inline-flex items-center gap-1"
        title={`Updated by ${user.username}`}
      >
        <Avatar
          src={user.avatar_url}
          seed={user.organization_id}
          size={16}
          className="rounded-full"
        />
      </span>
    );
  } catch {
    return null;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ organization: string }>;
}): Promise<Metadata> {
  const session = await auth();
  const { organization } = await props.params;
  if (!session?.user?.id) {
    return { title: "Blink" };
  }
  const org = await getOrganization(session.user.id, organization);
  return { title: `${org.name} - Blink` };
}

function formatUpdatedAgo(dateLike: Date | string | null): string {
  if (!dateLike) return "No deployments";
  const date = new Date(dateLike);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return "Updated now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `Updated ${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Updated ${months}mo ago`;
  const years = Math.floor(days / 365);
  return `Updated ${years}y ago`;
}

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const db = await getQuerier();
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const { organization: organizationName } = await params;
  const organization = await getOrganization(session.user.id, organizationName);
  const user = await getUser(session.user.id);
  const [agentsResult, members, agentDailyChats] = await Promise.all([
    db.selectAgentsForUser({
      userID: session.user.id,
      organizationID: organization.id,
      per_page: 100,
    }),
    db.selectOrganizationMembers({
      organizationID: organization.id,
      per_page: 100,
    }),
    db.selectAgentDailyChatsForOrganization({
      organizationID: organization.id,
    }),
  ]);

  // Sort agents by total chat count (descending)
  const agents = [...agentsResult.items].sort((a, b) => {
    const aChats = agentDailyChats.get(a.id) || [];
    const bChats = agentDailyChats.get(b.id) || [];
    const aTotal = aChats.reduce((sum, d) => sum + d.unique_chats, 0);
    const bTotal = bChats.reduce((sum, d) => sum + d.unique_chats, 0);
    return bTotal - aTotal;
  });

  const isPersonal = organization.id === user.organization_id;

  const DEFAULT_AGENT_NAME = "blink";

  // Find an agent with onboarding in progress (finished === false)
  const onboardingAgent = agents.find(
    (a) => a.onboarding_state?.finished === false
  );

  // Redirect to onboarding if organization has no agents
  if (agents.length === 0) {
    return redirect(`/${organizationName}/~/onboarding/${DEFAULT_AGENT_NAME}`);
  }

  // Redirect to agent onboarding if there's a one agent being onboarded
  if (agents.length === 1 && onboardingAgent) {
    return redirect(
      `/${organizationName}/~/onboarding/${onboardingAgent.name}`
    );
  }

  return (
    <div className="w-full relative">
      <Header user={user} organization={organization} />
      <OrganizationNavigation
        name={organization.name}
        isPersonal={isPersonal}
      />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div
          className={
            isPersonal
              ? "grid grid-cols-1 gap-6"
              : "grid grid-cols-1 lg:grid-cols-3 gap-6"
          }
        >
          <div className={isPersonal ? "" : "lg:col-span-2"}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Bot className="h-4 w-4" />
                <h2 className="text-sm font-medium">Agents</h2>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/new?org=${organization.name}`}>
                  <PlusIcon />
                  New
                </Link>
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                {agents.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="flex justify-center mb-4">
                      <Bot className="h-12 w-12 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-base font-medium mb-2">
                      No agents yet
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Get started by creating your first agent
                    </p>
                    <Button asChild>
                      <Link href={`/new?org=${organization.name}`}>
                        <PlusIcon />
                        Create agent
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {agents.map((agent) => {
                      const dailyChats = agentDailyChats.get(agent.id) || [];
                      const totalChats = dailyChats.reduce(
                        (sum, d) => sum + d.unique_chats,
                        0
                      );
                      return (
                        <Link
                          key={agent.id}
                          href={`/${organization.name}/${agent.name}`}
                          className="block p-4 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <Avatar
                                src={
                                  agent.avatar_file_id
                                    ? `/api/files/${agent.avatar_file_id}`
                                    : null
                                }
                                seed={agent.id}
                                size={32}
                                className="shrink-0 mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-base">
                                  {agent.name}
                                </div>
                                {agent.description && (
                                  <div className="mt-1 text-sm text-muted-foreground line-clamp-1">
                                    {agent.description}
                                  </div>
                                )}
                                <div className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                                  <span>
                                    {formatUpdatedAgo(
                                      agent.active_deployment_created_at
                                    )}
                                  </span>
                                  <LastUpdatedBy
                                    userId={agent.active_deployment_created_by}
                                  />
                                </div>
                              </div>
                            </div>
                            {dailyChats.length > 0 && (
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right min-w-[3rem]">
                                  <div className="text-lg font-medium tabular-nums">
                                    {totalChats.toLocaleString()}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    chats
                                  </div>
                                </div>
                                <div className="w-[60px] opacity-50">
                                  <AreaChart
                                    className="h-[32px]"
                                    data={dailyChats}
                                    index="interval"
                                    categories={["unique_chats"]}
                                    colors={["blue"]}
                                    showLegend={false}
                                    showXAxis={false}
                                    showYAxis={false}
                                    showGridLines={false}
                                    showTooltip={false}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {!isPersonal && (
            <div className="lg:col-span-1">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                People
              </h2>
              <Card>
                <CardContent className="pt-4">
                  <TooltipProvider>
                    <div className="flex flex-wrap gap-2">
                      {members.items.slice(0, 18).map((member) => (
                        <Tooltip key={member.user.id}>
                          <TooltipTrigger asChild>
                            <div>
                              <Avatar
                                src={member.user.avatar_url}
                                seed={member.user.organization_id}
                                size={36}
                                className="rounded-full"
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>@{member.user.username}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </TooltipProvider>
                  <div className="mt-3">
                    <Link
                      href={`/${organizationName}/~/people`}
                      className="text-sm text-primary hover:underline"
                    >
                      View all
                    </Link>
                  </div>
                  <div className="mt-3">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/${organizationName}/~/people?invite`}>
                        Invite someone
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
