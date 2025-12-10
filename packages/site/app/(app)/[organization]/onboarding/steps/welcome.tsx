"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type Client from "@blink.so/api";
import { Bot, Github, Loader2, MessageSquare, Globe } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface WelcomeStepProps {
  onContinue: () => void;
  client: Client;
  organizationId: string;
  onFileDownloaded: (fileId: string) => void;
  onAgentCreated: (agentId: string) => void;
  existingFileId?: string;
  existingAgentId?: string;
  agentName: string;
}

export function WelcomeStep({
  onContinue,
  client,
  organizationId,
  onFileDownloaded,
  onAgentCreated,
  existingFileId,
  existingAgentId,
  agentName,
}: WelcomeStepProps) {
  const [downloading, setDownloading] = useState(false);

  const handleGetStarted = async () => {
    if (existingFileId && existingAgentId) {
      onContinue();
      return;
    }

    setDownloading(true);
    try {
      // Download the agent files if not already done
      let fileId = existingFileId;
      if (!fileId) {
        const downloadResult = await client.onboarding.downloadAgent({
          organization_id: organizationId,
        });
        fileId = downloadResult.file_id;
        onFileDownloaded(fileId);
      }

      // Create the agent (without deployment) if not already done
      if (!existingAgentId) {
        const agent = await client.agents.create({
          organization_id: organizationId,
          name: agentName,
          description: "AI agent with GitHub, Slack, and web search integrations",
        });
        onAgentCreated(agent.id);
      }

      onContinue();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to initialize agent"
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">Deploy Your First Agent</CardTitle>
        <CardDescription className="text-base">
          Get started with a pre-built AI agent that includes powerful
          integrations for GitHub, Slack, and web search.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4">
          <div className="flex items-start gap-3">
            <Github className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div>
              <div className="font-medium">GitHub Integration</div>
              <div className="text-sm text-muted-foreground">
                Review PRs, respond to issues, and receive webhooks
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MessageSquare className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div>
              <div className="font-medium">Slack Integration</div>
              <div className="text-sm text-muted-foreground">
                Chat with your agent directly in Slack
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Globe className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div>
              <div className="font-medium">Web Search</div>
              <div className="text-sm text-muted-foreground">
                Search the web for up-to-date information
              </div>
            </div>
          </div>
        </div>

        <Button
          onClick={handleGetStarted}
          disabled={downloading}
          className="w-full"
          size="lg"
        >
          {downloading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Downloading agent...
            </>
          ) : (
            "Get Started"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
