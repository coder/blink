"use client";

import type Client from "@blink.so/api";
import type { OnboardingState } from "@blink.so/api";
import { Bot, Github, Globe, Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface AgentInfo {
  id: string;
  name: string;
  onboarding_state: OnboardingState;
}

interface WelcomeStepProps {
  onContinue: () => void;
  client: Client;
  organizationId: string;
  existingAgentId?: string;
  onAgentCreated: (agent: AgentInfo) => void;
  /** Name for the agent to create (defaults to "blink") */
  agentName?: string;
}

export function WelcomeStep({
  onContinue,
  client,
  organizationId,
  existingAgentId,
  onAgentCreated,
  agentName = "blink",
}: WelcomeStepProps) {
  const [loading, setLoading] = useState(false);

  const handleGetStarted = async () => {
    // If agent already exists, just continue
    if (existingAgentId) {
      onContinue();
      return;
    }

    setLoading(true);
    try {
      // Create agent
      const initialOnboardingState: OnboardingState = {
        currentStep: "welcome",
        finished: false,
      };

      const agent = await client.agents.create({
        organization_id: organizationId,
        name: agentName,
        onboarding_state: initialOnboardingState,
      });

      if (!agent.onboarding_state) {
        throw new Error(
          "Onboarding state on new agent not found - this should never happen"
        );
      }

      onAgentCreated({
        id: agent.id,
        name: agent.name,
        onboarding_state: agent.onboarding_state,
      });

      onContinue();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create agent"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-8 pb-6 space-y-6">
        <OnboardingStepHeader
          icon={Bot}
          title="Deploy Your First Agent"
          description="Get started with a pre-built AI agent that includes powerful integrations for GitHub, Slack, and web search."
          size="lg"
        />
        <div className="grid gap-4">
          <div className="flex items-start gap-3">
            <Github className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <div className="font-medium">GitHub Integration</div>
              <div className="text-sm text-muted-foreground">
                Review PRs, respond to issues, and receive webhooks
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MessageSquare className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <div className="font-medium">Slack Integration</div>
              <div className="text-sm text-muted-foreground">
                Chat with your agent directly in Slack
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Globe className="mt-0.5 h-5 w-5 text-muted-foreground" />
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
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Setting up...
            </>
          ) : (
            "Get Started"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
