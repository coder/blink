"use client";

import { Skeleton } from "@/components/ui/skeleton";
import Client from "@blink.so/api";
import { AlertCircle } from "lucide-react";
import useSWR from "swr";
import AgentSource from "../components/agent-source";

const client = new Client();

export default function SourceView({
  agentId,
  deploymentId,
}: {
  agentId: string;
  deploymentId: string | null;
}) {
  const {
    data: deployment,
    error,
    isLoading,
  } = useSWR(
    deploymentId ? `agent-deployment-${agentId}-${deploymentId}` : null,
    async () => {
      if (!deploymentId) return null;
      return client.agents.deployments.get({
        agent_id: agentId,
        deployment_id: deploymentId,
      });
    }
  );

  if (isLoading) {
    return (
      <div className="space-y-4 h-full">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96 text-destructive">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <p className="text-sm">Failed to load deployment</p>
        </div>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">No deployments found</p>
          <p className="text-xs mt-2">
            Deploy your agent using the Blink CLI to see source files
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-hidden">
      <AgentSource deployment={deployment} />
    </div>
  );
}
