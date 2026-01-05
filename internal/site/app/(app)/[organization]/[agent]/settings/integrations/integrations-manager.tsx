"use client";

import type { IntegrationsState } from "@blink.so/api";
import { Key, Search } from "lucide-react";
import { useState } from "react";
import { GitHubIcon } from "@/components/icons/github";
import { SlackIcon } from "@/components/slack-icon";
import { GitHubIntegration } from "./github-integration";
import { IntegrationCard } from "./integration-card";
import { LlmIntegration } from "./llm-integration";
import { SlackIntegration } from "./slack-integration";
import { WebSearchIntegration } from "./web-search-integration";

type ActiveSetup = "llm" | "web-search" | "github" | "slack" | null;

interface IntegrationsManagerProps {
  agentId: string;
  agentName: string;
  integrationsState: IntegrationsState | null;
}

export default function IntegrationsManager({
  agentId,
  agentName,
  integrationsState,
}: IntegrationsManagerProps) {
  const [activeSetup, setActiveSetup] = useState<ActiveSetup>(null);
  // Derive initial configured status from integrationsState
  const [configured, setConfigured] = useState({
    llm: !!integrationsState?.llm,
    webSearch: !!integrationsState?.webSearch,
    github: !!integrationsState?.github,
    slack: !!integrationsState?.slack,
  });

  const handleComplete = (integration: keyof typeof configured) => {
    setConfigured((prev) => ({ ...prev, [integration]: true }));
    setActiveSetup(null);
  };

  const handleCancel = () => {
    setActiveSetup(null);
  };

  // Render active setup wizard
  if (activeSetup === "llm") {
    return (
      <LlmIntegration
        agentId={agentId}
        onComplete={() => handleComplete("llm")}
        onCancel={handleCancel}
      />
    );
  }

  if (activeSetup === "web-search") {
    return (
      <WebSearchIntegration
        agentId={agentId}
        onComplete={() => handleComplete("webSearch")}
        onCancel={handleCancel}
      />
    );
  }

  if (activeSetup === "github") {
    return (
      <GitHubIntegration
        agentId={agentId}
        agentName={agentName}
        onComplete={() => handleComplete("github")}
        onCancel={handleCancel}
      />
    );
  }

  if (activeSetup === "slack") {
    return (
      <SlackIntegration
        agentId={agentId}
        agentName={agentName}
        onComplete={() => handleComplete("slack")}
        onCancel={handleCancel}
      />
    );
  }

  // Render integration cards grid
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-medium">Integrations</h3>
        <p className="text-sm text-muted-foreground">
          Connect your agent to external services to extend its capabilities.
        </p>
      </div>
      <div className="grid gap-4">
        <IntegrationCard
          title="LLM API Key"
          description="Configure an API key for AI capabilities"
          icon={<Key className="h-5 w-5 text-white" />}
          iconBgColor="bg-amber-500"
          configured={configured.llm}
          onConfigure={() => setActiveSetup("llm")}
        />
        <IntegrationCard
          title="Web Search (Exa)"
          description="Enable web search capabilities"
          icon={<Search className="h-5 w-5 text-white" />}
          iconBgColor="bg-blue-500"
          configured={configured.webSearch}
          onConfigure={() => setActiveSetup("web-search")}
        />
        <IntegrationCard
          title="GitHub"
          description="Connect to GitHub repositories"
          icon={<GitHubIcon className="h-5 w-5 text-white" />}
          iconBgColor="bg-[#24292f]"
          configured={configured.github}
          onConfigure={() => setActiveSetup("github")}
        />
        <IntegrationCard
          title="Slack"
          description="Chat with your agent in Slack"
          icon={<SlackIcon className="h-5 w-5 text-white" />}
          iconBgColor="bg-[#4A154B]"
          configured={configured.slack}
          onConfigure={() => setActiveSetup("slack")}
        />
      </div>
    </div>
  );
}
