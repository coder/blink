"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Github,
  Key,
  Loader2,
  Rocket,
  Search,
} from "lucide-react";
import type { ComponentType } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { SlackIcon } from "@/components/slack-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAPIClient } from "@/lib/api-client";
import type { OnboardingStep } from "../wizard";

type Status = "summary" | "deploying" | "error";

interface ConfigItem {
  id: string;
  label: string;
  configured: boolean;
  value?: string;
  notConfiguredDescription: string;
  icon?: LucideIcon;
  IconComponent?: ComponentType<{ className?: string }>;
  step: OnboardingStep;
}

function DeployingInProgress() {
  return (
    <div className="w-full">
      <Card>
        <CardContent className="pt-8 pb-6">
          <OnboardingStepHeader
            icon={Rocket}
            title="Deploying Your Agent"
            description="This may take a moment. Please don't close this page."
            size="lg"
          />
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeployingError({
  message,
  onBack,
}: {
  message?: string;
  onBack: () => void;
}) {
  return (
    <div className="w-full">
      <Card>
        <CardContent className="pt-8 pb-6">
          <OnboardingStepHeader
            icon={AlertCircle}
            iconBgClassName="bg-destructive/10"
            iconClassName="text-destructive"
            title="Deployment Failed"
            description={
              <>
                {message || "Something went wrong during deployment."} Please
                check the server logs.
              </>
            }
            size="lg"
          />
          <div className="flex justify-center mt-6">
            <Button onClick={onBack}>Go Back</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeployingSummary({
  configItems,
  onDeploy,
  onBack,
  goToStep,
}: {
  configItems: ConfigItem[];
  onDeploy: () => void;
  onBack: () => void;
  goToStep: (step: OnboardingStep) => void;
}) {
  return (
    <div className="w-full">
      <Card>
        <CardContent className="pt-8 pb-6 space-y-4">
          <OnboardingStepHeader
            icon={Rocket}
            title="Ready to Deploy"
            description="Review your configuration before deploying your agent."
            size="lg"
          />
          <div className="space-y-2">
            {configItems.map((item) => {
              const IconComponent = item.IconComponent;
              const LucideIcon = item.icon;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {item.configured ? (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10">
                        <Check className="h-4 w-4 text-green-500" />
                      </div>
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/10">
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        {IconComponent ? (
                          <IconComponent className="h-4 w-4 text-muted-foreground" />
                        ) : LucideIcon ? (
                          <LucideIcon className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                        <span className="font-medium">{item.label}</span>
                      </div>
                      {!item.configured && (
                        <span className="text-xs text-muted-foreground">
                          {item.notConfiguredDescription}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.configured ? (
                      <span className="text-sm text-muted-foreground">
                        {item.value}
                      </span>
                    ) : (
                      <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-600">
                        Not configured
                      </span>
                    )}
                    <Button
                      variant={item.configured ? "ghost" : "default"}
                      size="sm"
                      onClick={() => goToStep(item.step)}
                    >
                      {item.configured ? "Edit" : "Set up"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {configItems.some((item) => !item.configured) && (
            <p className="text-xs text-muted-foreground text-center my-6">
              You may still deploy the agent, but its functionality will be
              limited.
            </p>
          )}

          <div className="flex justify-between pt-4 border-t">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={onDeploy}>
              <Rocket className="mr-2 h-4 w-4" />
              Deploy
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface DeployingStepProps {
  organizationId: string;
  agentId: string;
  slack?: {
    botToken: string;
    signingSecret: string;
  };
  llm?: {
    provider?: "anthropic" | "openai" | "vercel";
    apiKey?: string;
  };
  webSearch?: {
    provider?: "exa";
    apiKey?: string;
  };
  github?: {
    appName: string;
    appUrl: string;
    installUrl: string;
    appId?: number;
    clientId?: string;
    clientSecret?: string;
    webhookSecret?: string;
    privateKey?: string;
  };
  goToStep: (step: OnboardingStep) => void;
  onSuccess: (agentId: string) => void;
  /** Initial status for stories */
  initialStatus?: Status;
}

const providerNames: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  vercel: "Vercel AI Gateway",
};

export function DeployingStep({
  organizationId,
  agentId,
  slack,
  llm,
  webSearch,
  github,
  goToStep,
  onSuccess,
  initialStatus = "summary",
}: DeployingStepProps) {
  const client = useAPIClient();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasStartedRef = useRef(false);

  const deploy = async () => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    setStatus("deploying");

    try {
      // Download the agent files
      const downloadResult = await client.onboarding.downloadAgent({
        organization_id: organizationId,
      });

      // Build environment variables
      const env: Array<{ key: string; value: string; secret: boolean }> = [];

      if (slack?.botToken) {
        env.push({
          key: "SLACK_BOT_TOKEN",
          value: slack.botToken,
          secret: true,
        });
      }
      if (slack?.signingSecret) {
        env.push({
          key: "SLACK_SIGNING_SECRET",
          value: slack.signingSecret,
          secret: true,
        });
      }
      if (webSearch?.apiKey) {
        env.push({
          key: "EXA_API_KEY",
          value: webSearch.apiKey,
          secret: true,
        });
      }
      // Set the appropriate API key based on the selected provider
      if (llm?.apiKey && llm?.provider) {
        const envKeyMap: Record<string, string> = {
          anthropic: "ANTHROPIC_API_KEY",
          openai: "OPENAI_API_KEY",
          vercel: "AI_GATEWAY_API_KEY",
        };
        env.push({
          key: envKeyMap[llm.provider],
          value: llm.apiKey,
          secret: true,
        });
      }
      if (
        github?.appId &&
        github.clientId &&
        github.clientSecret &&
        github.webhookSecret &&
        github.privateKey
      ) {
        env.push({
          key: "GITHUB_APP_ID",
          value: github.appId.toString(),
          secret: false,
        });
        env.push({
          key: "GITHUB_CLIENT_ID",
          value: github.clientId,
          secret: false,
        });
        env.push({
          key: "GITHUB_CLIENT_SECRET",
          value: github.clientSecret,
          secret: true,
        });
        env.push({
          key: "GITHUB_WEBHOOK_SECRET",
          value: github.webhookSecret,
          secret: true,
        });
        env.push({
          key: "GITHUB_PRIVATE_KEY",
          value: github.privateKey,
          secret: true,
        });
      }

      // Set environment variables on the existing agent
      const envResults = await Promise.allSettled(
        env.map(async (variable) => {
          await client.agents.env.create({
            agent_id: agentId,
            key: variable.key,
            value: variable.value,
            secret: variable.secret,
            upsert: true,
          });
        })
      );
      const errEnvResults = envResults.filter(
        (result) => result.status === "rejected"
      );
      if (errEnvResults.length > 0) {
        throw new Error(
          `Failed to set environment variables: ${errEnvResults.map((result) => result.reason).join(", ")}`
        );
      }

      // Deploy the agent with the downloaded files
      await client.agents.deployments.create({
        agent_id: agentId,
        output_files: downloadResult.output_files,
        source_files: downloadResult.source_files,
        entrypoint: downloadResult.entrypoint,
        target: "production",
      });

      onSuccess(agentId);
    } catch (error) {
      setStatus("error");
      hasStartedRef.current = false;
      const message =
        error instanceof Error ? error.message : "Deployment failed";
      setErrorMessage(message);
      toast.error(message);
    }
  };

  // Configuration items for the summary
  const configItems: ConfigItem[] = [
    {
      id: "llm",
      label: "LLM API Key",
      configured: !!llm?.apiKey,
      value: llm?.provider ? providerNames[llm.provider] : undefined,
      notConfiguredDescription: "The agent will not be able to respond.",
      icon: Key,
      step: "llm-api-keys",
    },
    {
      id: "github",
      label: "GitHub",
      configured: !!github?.appName,
      value: "Connected",
      notConfiguredDescription:
        "The agent will not be able to access GitHub repositories.",
      icon: Github,
      step: "github-setup",
    },
    {
      id: "slack",
      label: "Slack",
      configured: !!slack?.botToken,
      value: "Connected",
      notConfiguredDescription: "The agent will not be available in Slack.",
      IconComponent: SlackIcon,
      step: "slack-setup",
    },
    {
      id: "web-search",
      label: "Web Search",
      configured: !!webSearch?.apiKey,
      value: "Exa",
      notConfiguredDescription: "The agent will not be able to search the web.",
      icon: Search,
      step: "web-search",
    },
  ];

  if (status === "error") {
    return (
      <DeployingError
        message={errorMessage ?? undefined}
        onBack={() => setStatus("summary")}
      />
    );
  }

  if (status === "deploying") {
    return <DeployingInProgress />;
  }

  return (
    <DeployingSummary
      configItems={configItems}
      onDeploy={deploy}
      onBack={() => goToStep("web-search")}
      goToStep={goToStep}
    />
  );
}
