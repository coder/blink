"use client";

import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AgentDeployment,
  ListAgentRunStepsResponse,
  ListAgentRunsResponse,
} from "@blink.so/api";
import Client from "@blink.so/api";
import { Activity, AlertCircle, ArrowLeft, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";

const client = new Client();

function StatusDot({ status }: { status: string | null | undefined }) {
  const s = (status || "").toLowerCase();
  const color =
    s === "success"
      ? "bg-green-500"
      : s === "failed"
        ? "bg-red-500"
        : s === "deploying"
          ? "bg-blue-500"
          : "bg-slate-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return value as string;
  }
}

function formatDuration(
  createdAt?: string | null,
  updatedAt?: string | null,
  inProgress?: boolean
): string {
  if (!createdAt) return "—";
  const start = new Date(createdAt).getTime();
  const end = inProgress
    ? Date.now()
    : updatedAt
      ? new Date(updatedAt).getTime()
      : start;
  const ms = Math.max(0, end - start);
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function CreatedBy({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string | null | undefined;
}) {
  const { data } = useSWR(
    userId ? `org-member-${organizationId}-${userId}` : null,
    () => {
      if (!userId) return null;
      return client.organizations.members.get({
        organization_id: organizationId,
        user_id: userId,
      });
    }
  );
  const user = data?.user;
  if (!user) return <span className="text-sm">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="truncate">{user.display_name || user.username}</span>
      <Avatar
        src={user.avatar_url}
        seed={user.organization_id}
        size={16}
        className="border-0"
      />
    </span>
  );
}

export default function DeploymentDetailClient({
  agentId,
  agentName,
  deploymentNumber,
  organizationId,
  organizationName,
  agentSlug,
}: {
  agentId: string;
  agentName: string;
  deploymentNumber: number;
  organizationId: string;
  organizationName: string;
  agentSlug: string;
}) {
  const { data, error, isLoading } = useSWR(
    `agent-deployment-${agentId}-${deploymentNumber}`,
    () =>
      client.agents.deployments.get({
        agent_id: agentId,
        deployment_number: deploymentNumber,
      }),
    { refreshInterval: 5000 }
  );

  const { data: runsData } = useSWR(
    data?.id ? `agent-deployment-runs-${agentId}-${data.id}` : null,
    async (): Promise<ListAgentRunsResponse> => {
      if (!data?.id) return { items: [], next_cursor: null };
      return client.agents.runs.list({
        agent_id: agentId,
        agent_deployment_id: data.id,
        limit: 100,
      });
    }
  );

  const { data: stepsData } = useSWR(
    data?.id ? `agent-deployment-steps-${agentId}-${data.id}` : null,
    async (): Promise<ListAgentRunStepsResponse> => {
      if (!data?.id) return { items: [], next_cursor: null };
      return client.agents.steps.list({
        agent_id: agentId,
        agent_deployment_id: data.id,
        limit: 100,
      });
    }
  );

  // Build URLs for filtered logs and traces (before early returns to follow Rules of Hooks)
  const logsUrl = useMemo(() => {
    if (!data?.id) return `/${organizationName}/${agentSlug}/logs`;
    const filters = {
      type: "and",
      filters: [{ type: "eq", key: "agent.deployment_id", value: data.id }],
    };
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
    });
    return `/${organizationName}/${agentSlug}/logs?${params.toString()}`;
  }, [data?.id, organizationName, agentSlug]);

  const tracesUrl = useMemo(() => {
    if (!data?.id) return `/${organizationName}/${agentSlug}/traces`;
    const filters = {
      type: "and",
      filters: [{ type: "eq", key: "agent.deployment_id", value: data.id }],
    };
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
    });
    return `/${organizationName}/${agentSlug}/traces?${params.toString()}`;
  }, [data?.id, organizationName, agentSlug]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 text-sm text-destructive bg-red-50 dark:bg-red-900/20 rounded">
        Failed to load deployment
      </div>
    );
  }

  const d: AgentDeployment = data;
  const inProgress = ["deploying", "pending"].includes(d.status.toLowerCase());

  const totalRuns = runsData?.items?.length || 0;
  const totalSteps = stepsData?.items?.length || 0;

  return (
    <div className="flex flex-col flex-1 w-full">
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="flex h-14 items-center px-8 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Link
              href={`/${organizationName}/${agentSlug}/deployments`}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="font-mono text-lg font-medium">#{d.number}</h1>
              <Badge
                variant="outline"
                className="rounded-full text-xs px-2.5 py-0.5 capitalize"
              >
                {d.target}
              </Badge>
              <div className="flex items-center gap-1.5">
                <StatusDot status={d.status} />
                <span className="text-sm capitalize">{d.status}</span>
              </div>
            </div>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {formatDuration(d.created_at, d.updated_at, inProgress)}
            </span>
          </div>

          <div className="flex gap-2">
            <Link href={logsUrl}>
              <Button variant="outline" size="sm" className="gap-2">
                <Activity className="h-4 w-4" />
                Logs
              </Button>
            </Link>
            <Link href={tracesUrl}>
              <Button variant="outline" size="sm" className="gap-2">
                <Activity className="h-4 w-4" />
                Traces
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="p-8 max-w-6xl mx-auto w-full space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 border rounded-lg bg-muted/20">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Chat Runs</span>
            </div>
            <div className="text-2xl font-medium">
              {totalRuns.toLocaleString()}
              {totalRuns === 100 && "+"}
            </div>
          </div>

          <div className="p-4 border rounded-lg bg-muted/20">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Steps</span>
            </div>
            <div className="text-2xl font-medium">
              {totalSteps.toLocaleString()}
              {totalSteps === 100 && "+"}
            </div>
          </div>

          <div className="p-4 border rounded-lg bg-muted/20">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Status</span>
            </div>
            <div className="text-2xl font-medium capitalize">{d.status}</div>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
            <div className="text-sm font-medium">Deployment Info</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatTime(d.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span>{formatTime(d.updated_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created by</span>
                <CreatedBy
                  organizationId={organizationId}
                  userId={d.created_by}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
            <div className="text-sm font-medium">Platform Details</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform</span>
                <span className="capitalize">{d.platform || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Memory</span>
                <span>
                  {d.platform_memory_mb ? `${d.platform_memory_mb} MB` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region</span>
                <span>{d.platform_region || "—"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* User Message */}
        {d.user_message && (
          <div className="p-4 border rounded-lg bg-muted/20">
            <div className="text-sm font-medium mb-2">Deployment Message</div>
            <div className="text-sm text-muted-foreground">
              {d.user_message}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
