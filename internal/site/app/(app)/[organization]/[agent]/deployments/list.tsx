"use client";

import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import Client from "@blink.so/api";
import {
  MapPin,
  MemoryStick,
  MessageSquareText,
  MoreHorizontal,
  RotateCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

const client = new Client();

function getStatusLabel(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "success") return "Ready";
  if (s === "failed") return "Failed";
  if (s === "deploying") return "Deploying";
  return "Pending";
}

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
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color} -mt-0.5`}
    />
  );
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

// New: human friendly created-at relative time like "1 hour ago"
function formatTimeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "now";
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return date.toLocaleDateString();
}

function CreatedBy({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const { data } = useSWR(
    userId ? `org-member-${organizationId}-${userId}` : null,
    () =>
      client.organizations.members.get({
        organization_id: organizationId,
        user_id: userId,
      })
  );
  const user = data?.user;
  if (!user) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
      <span className="truncate max-w-[180px]">by {user.username}</span>
      <Avatar
        src={user.avatar_url}
        seed={user.organization_id}
        size={24}
        className="rounded-full"
      />
    </span>
  );
}

export default function DeploymentsList({
  agentId,
  organizationId,
  activeDeploymentId,
  canDeploy = false,
}: {
  agentId: string;
  organizationId: string;
  activeDeploymentId?: string | null;
  canDeploy?: boolean;
}) {
  const [redeployDialogOpen, setRedeployDialogOpen] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<any>(null);
  const [isRedeploying, setIsRedeploying] = useState(false);

  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite(
    (index: number, previousPage: any | null) => {
      if (!agentId) return null;
      if (index === 0) return ["agent-deployments", agentId, 1];
      if (!previousPage || previousPage.has_more === false) return null;
      return ["agent-deployments", agentId, index + 1];
    },
    async ([_label, id, page]: [string, string, number]) => {
      return client.agents.deployments.list({
        agent_id: id,
        per_page: 10,
        order: "desc",
        page,
      });
    },
    { refreshInterval: 5000, persistSize: true }
  );

  // Live active deployment id (polls client-side)
  const { data: agentState } = useSWR(
    agentId ? `agent-${agentId}` : null,
    () => client.agents.get(agentId),
    { refreshInterval: 5000 }
  );
  const activeDeploymentIdLive =
    agentState?.active_deployment_id ?? activeDeploymentId;

  const handleRedeploy = async () => {
    if (!selectedDeployment) return;
    setIsRedeploying(true);
    try {
      await client.agents.deployments.redeploy({
        agent_id: agentId,
        deployment_id: selectedDeployment.id,
      });
      await mutate();
      setRedeployDialogOpen(false);
      setSelectedDeployment(null);
    } catch (err) {
      console.error("Failed to redeploy:", err);
    } finally {
      setIsRedeploying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full">
        <div className="rounded-xl border overflow-hidden divide-y divide-border w-full">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-12 items-center gap-4 p-4 bg-muted/20"
            >
              <div className="col-span-3 min-w-0">
                <div className="flex items-center gap-1">
                  <Skeleton className="h-5 w-14" />
                </div>
                <div className="mt-1">
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="mt-1">
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
              <div className="col-span-3">
                <div className="min-h-[18px]">
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="mt-1">
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
              <div className="col-span-3 flex items-center justify-end gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-6 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive bg-red-50 dark:bg-red-900/20 rounded">
        Failed to load deployments
      </div>
    );
  }

  const pages = data ?? [];
  const items = pages.flatMap((p: any) => p.items ?? []);
  const hasMore = pages.length > 0 ? pages[pages.length - 1]?.has_more : false;
  const isLoadingMore =
    isLoading || (size > 0 && typeof pages[size - 1] === "undefined");

  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No deployments yet
      </div>
    );
  }

  return (
    <>
      <div className="w-full">
        <div className="rounded-xl border overflow-hidden divide-y divide-border w-full">
          {items.map((deployment: any) => {
            const inProgress = ["deploying", "pending"].includes(
              (deployment.status || "").toLowerCase()
            );
            const duration = formatDuration(
              deployment.created_at,
              deployment.updated_at,
              inProgress
            );
            const isActive =
              activeDeploymentIdLive &&
              deployment.id === activeDeploymentIdLive;
            return (
              <div
                key={deployment.id}
                className="relative grid grid-cols-12 items-center gap-4 p-4 bg-muted/20 hover:bg-muted/30 transition-colors group"
              >
                <Link
                  href={`./deployments/${deployment.number}`}
                  className="absolute inset-0 z-0"
                />

                {/* Left: number with target below */}
                <div className="col-span-3 min-w-0 relative z-10 pointer-events-none">
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-md font-mono whitespace-nowrap">
                      #{deployment.number}
                    </span>
                  </div>
                  <div className="mt-1 capitalize text-sm text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <span className="truncate">{deployment.target}</span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium border border-blue-500/20 bg-blue-500/10 text-blue-500 ml-2 whitespace-nowrap">
                        <Sparkles className="w-3.5 h-3.5" /> Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Status with duration under */}
                <div className="col-span-3 relative z-10 pointer-events-none">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={deployment.status} />
                    <span className="text-sm whitespace-nowrap">
                      {getStatusLabel(deployment.status)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 whitespace-nowrap">
                    {duration}{" "}
                    <span className="opacity-80">
                      ({formatTimeAgo(deployment.created_at)})
                    </span>
                  </div>
                </div>

                {/* Middle: message with icon, then memory and region with icons */}
                <div className="col-span-3 text-sm text-muted-foreground relative z-10 pointer-events-none">
                  <div className="truncate text-foreground/90 flex items-start gap-1.5 min-h-[18px]">
                    {deployment.user_message ? (
                      <>
                        <MessageSquareText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {deployment.user_message}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="opacity-80 flex items-center gap-3 mt-1 whitespace-nowrap">
                    {deployment.platform_memory_mb ? (
                      <span className="inline-flex items-center gap-1">
                        <MemoryStick className="w-3.5 h-3.5" />
                        {deployment.platform_memory_mb} MB
                      </span>
                    ) : null}
                    {deployment.platform_region ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {deployment.platform_region}
                      </span>
                    ) : null}
                    {!deployment.platform_memory_mb &&
                    !deployment.platform_region ? (
                      <span>—</span>
                    ) : null}
                  </div>
                </div>

                <div className="col-span-3 flex items-center justify-end gap-2 relative z-10">
                  <span className="text-sm text-muted-foreground pointer-events-none whitespace-nowrap">
                    {formatTimeAgo(deployment.created_at)}
                  </span>
                  {deployment.created_by && (
                    <span className="pointer-events-none">
                      <CreatedBy
                        organizationId={organizationId}
                        userId={deployment.created_by}
                      />
                    </span>
                  )}
                  {canDeploy && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDeployment(deployment);
                            setRedeployDialogOpen(true);
                          }}
                        >
                          <RotateCw className="mr-2 h-4 w-4" />
                          Re-deploy
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {hasMore ? (
          <div className="flex justify-center py-2">
            <Button
              variant="outline"
              onClick={() => setSize(size + 1)}
              disabled={isLoadingMore}
              className="w-full"
            >
              {isLoadingMore ? "Loading..." : "Load More"}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={redeployDialogOpen} onOpenChange={setRedeployDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-deploy #{selectedDeployment?.number}?</DialogTitle>
            <DialogDescription>
              This will create a new deployment with the same configuration as
              deployment #{selectedDeployment?.number}. The new deployment will
              use the same files and settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRedeployDialogOpen(false)}
              disabled={isRedeploying}
            >
              Cancel
            </Button>
            <Button onClick={handleRedeploy} disabled={isRedeploying}>
              {isRedeploying ? (
                <>
                  <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                  Re-deploying...
                </>
              ) : (
                <>
                  <RotateCw className="mr-2 h-4 w-4" />
                  Re-deploy
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
