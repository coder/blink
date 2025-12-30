"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAPIClient } from "@/lib/api-client";
import type { Agent } from "@blink.so/api";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AgentAvatarForm } from "./agent-avatar-form";

interface AgentSettingsFormProps {
  agent: Agent;
  organizationName: string;
  agentName: string;
}

export function AgentSettingsForm({
  agent,
  organizationName,
  agentName,
}: AgentSettingsFormProps) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description || "");
  // const [chatExpireTtl, setChatExpireTtl] = useState(agent.chat_expire_ttl);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const client = useAPIClient();

  const hasNameChanges = name !== agent.name;
  const hasDescriptionChanges = description !== (agent.description || "");
  // const hasRetentionChanges = chatExpireTtl !== agent.chat_expire_ttl;
  const hasChanges = hasNameChanges || hasDescriptionChanges;
  // hasNameChanges || hasDescriptionChanges || hasRetentionChanges;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return;

    startTransition(async () => {
      try {
        await client.agents.update({
          id: agent.id,
          name: hasNameChanges ? name : undefined,
          description: hasDescriptionChanges ? description : undefined,
          // chat_expire_ttl: hasRetentionChanges ? chatExpireTtl : undefined,
        });

        toast.success("Agent updated successfully");

        // If name changed, redirect to new URL, otherwise just refresh
        if (hasNameChanges) {
          router.push(`/${organizationName}/${name}/settings`);
        } else {
          router.refresh();
        }
      } catch (error) {
        console.error("Failed to update agent:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to update agent"
        );
      }
    });
  };

  return (
    <div className="space-y-8">
      <form onSubmit={handleUpdate} className="space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between lg:gap-16 space-y-8 lg:space-y-0">
          <div className="flex-1 space-y-8">
            <div className="space-y-2">
              <label
                htmlFor="agent_name"
                className="text-sm font-medium text-foreground"
              >
                Name
              </label>
              <Input
                id="agent_name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="Enter agent name"
                maxLength={40}
                pattern="[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}"
              />
              <p className="text-sm text-muted-foreground">
                Lowercase letters, numbers, and hyphens only. Cannot start or
                end with a hyphen.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="agent_description"
                className="text-sm font-medium text-foreground"
              >
                Description
              </label>
              <Textarea
                id="agent_description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter agent description"
                rows={3}
              />
            </div>

            {/* <div className="space-y-2">
              <label
                htmlFor="chat_expire_ttl"
                className="text-sm font-medium text-foreground"
              >
                Chat Expiration
              </label>
              <select
                id="chat_expire_ttl"
                value={chatExpireTtl ?? ""}
                onChange={(e) =>
                  setChatExpireTtl(
                    e.target.value === "" ? null : parseInt(e.target.value)
                  )
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Never (keep forever)</option>
                <option value={60 * 60}>1 hour</option>
                <option value={4 * 60 * 60}>4 hours</option>
                <option value={8 * 60 * 60}>8 hours</option>
                <option value={12 * 60 * 60}>12 hours</option>
                <option value={24 * 60 * 60}>24 hours</option>
                <option value={7 * 24 * 60 * 60}>1 week</option>
                <option value={30 * 24 * 60 * 60}>30 days</option>
                <option value={365 * 24 * 60 * 60}>1 year</option>
              </select>
              <p className="text-sm text-muted-foreground">
                Chats will be deleted after this duration of inactivity. Useful
                for clearing old data from inactive agents like Slack bots.
              </p>
            </div> */}

            <div className="flex">
              <Button
                onClick={handleUpdate}
                disabled={!hasChanges || isPending}
              >
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>

          <AgentAvatarForm agent={agent} />
        </div>
      </form>
    </div>
  );
}
