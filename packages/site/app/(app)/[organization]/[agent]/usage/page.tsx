import { auth } from "@/app/(auth)/auth";
import { getQuerier } from "@/lib/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../layout";
import { AgentUsageClient } from "./agent-usage";
import type { TimeRange } from "./time-range-selector";

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
  return { title: `Usage · ${ag.name} · ${org.name} - Blink` };
}

function getTimeRangeConfig(range: TimeRange): {
  days: number;
  granularity: "1 hour" | "1 day";
} {
  switch (range) {
    case "24h":
      return { days: 1, granularity: "1 hour" };
    case "7d":
      return { days: 7, granularity: "1 hour" };
    case "30d":
      return { days: 30, granularity: "1 day" };
  }
}

export default async function UsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string; agent: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const userID = session.user.id;
  const { organization: organizationName, agent: agentName } = await params;
  const [organization, agent] = await Promise.all([
    getOrganization(userID, organizationName),
    getAgent(organizationName, agentName),
  ]);

  const resolvedSearchParams = await searchParams;
  const range = (resolvedSearchParams.range as TimeRange) || "30d";
  const { days, granularity } = getTimeRangeConfig(range);

  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - days);

  // Normalize dates to day boundaries for daily granularity to ensure
  // we capture complete days of data. Without this, we'd miss partial days
  // at the start and end of the range.
  if (granularity === "1 day") {
    startTime.setHours(0, 0, 0, 0);
    endTime.setHours(23, 59, 59, 999);
  }

  const db = await getQuerier();
  const [dailyChats, tokenStats, dailyRuntime, tokenUsageByModel, ttftByModel] =
    await Promise.all([
      db.selectAgentChatsWithGranularity({
        agentID: agent.id,
        startDate: startTime,
        endDate: endTime,
        granularity,
      }),
      db.selectAgentTokenUsageStats({
        agentID: agent.id,
        startDate: startTime,
        endDate: endTime,
      }),
      db.selectAgentRuntimeWithGranularity({
        agentID: agent.id,
        startDate: startTime,
        endDate: endTime,
        granularity,
      }),
      db.selectAgentTokenUsageByModelWithGranularity({
        agentID: agent.id,
        startDate: startTime,
        endDate: endTime,
        granularity,
      }),
      db.selectAgentTTFTByModelWithGranularity({
        agentID: agent.id,
        startDate: startTime,
        endDate: endTime,
        granularity,
      }),
    ]);

  const totalRuntime = dailyRuntime.reduce(
    (sum: number, d) => sum + d.runtime_seconds,
    0
  );

  return (
    <AgentUsageClient
      agentName={agent.name}
      totalRuntime={totalRuntime}
      dailyChats={dailyChats}
      tokenStats={tokenStats}
      dailyRuntime={dailyRuntime}
      tokenUsageByModel={tokenUsageByModel}
      ttftByModel={ttftByModel}
      startDate={startTime}
      endDate={endTime}
      timeRange={range}
      granularity={granularity}
    />
  );
}
