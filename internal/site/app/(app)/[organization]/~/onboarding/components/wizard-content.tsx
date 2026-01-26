"use client";

import type Client from "@blink.so/api";
import type { IntegrationsState, OnboardingState } from "@blink.so/api";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { DeployingStep } from "../steps/deploying";
import { GitHubSetupStep } from "../steps/github-setup";
import { LlmApiKeysStep } from "../steps/llm-api-keys";
import { SlackSetupStep } from "../steps/slack-setup";
import { SuccessStep } from "../steps/success";
import { WebSearchStep } from "../steps/web-search";
import { WelcomeStep } from "../steps/welcome";
import { ProgressIndicator } from "./progress-indicator";

export type { OnboardingState };
export type OnboardingStep = OnboardingState["currentStep"];

export interface AgentInfo {
  id: string;
  name: string;
  onboarding_state: OnboardingState;
}

interface WizardContentProps {
  organizationId: string;
  organizationName: string;
  client: Client;
  /** Agent with existing onboarding state (for resuming onboarding) */
  initialAgent?: AgentInfo;
  /** Name for the agent to create (defaults to "blink") */
  agentName?: string;
}

export function WizardContent({
  organizationId,
  organizationName,
  client,
  initialAgent,
  agentName = "blink",
}: WizardContentProps) {
  const router = useRouter();

  const [agentInfo, setAgentInfo] = useState<AgentInfo | undefined>(
    initialAgent
  );

  const [state, setState] = useState<OnboardingState>(() => {
    if (initialAgent) {
      return initialAgent.onboarding_state;
    }
    return { currentStep: "welcome", finished: false };
  });

  const updateOnboardingState = useCallback(
    async (updates: Partial<OnboardingState>) => {
      const newState = { ...state, ...updates };
      setState(newState);

      if (agentInfo) {
        try {
          await client.agents.updateOnboarding(agentInfo.id, newState);
        } catch (error) {
          // biome-ignore lint/suspicious/noConsole: useful for debugging
          console.error("Failed to update onboarding state:", error);
        }
      }
    },
    [state, agentInfo, client]
  );

  const goToStep = useCallback(
    async (step: OnboardingStep) => {
      await updateOnboardingState({ currentStep: step });
    },
    [updateOnboardingState]
  );

  const clearAndRedirect = useCallback(async () => {
    if (agentInfo) {
      const integrationsState: IntegrationsState = {};
      if (state.llm?.apiKey) integrationsState.llm = true;
      if (state.github?.appId) integrationsState.github = true;
      if (state.slack?.botToken) integrationsState.slack = true;
      if (state.webSearch?.apiKey) integrationsState.webSearch = true;

      try {
        await client.agents.updateIntegrationsState(
          agentInfo.id,
          integrationsState
        );
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: useful for debugging
        console.error("Failed to update integrations state:", error);
      }

      try {
        await client.agents.clearOnboarding(agentInfo.id);
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: useful for debugging
        console.error("Failed to clear onboarding state:", error);
      }
    }
    const redirectName = agentInfo?.name ?? agentName;
    router.push(`/${organizationName}/${redirectName}/chats`);
  }, [agentInfo, client, router, organizationName, agentName, state]);

  const handleAgentCreated = useCallback((agent: AgentInfo) => {
    setAgentInfo(agent);
    setState(agent.onboarding_state);
  }, []);

  const steps: OnboardingStep[] = [
    "welcome",
    "llm-api-keys",
    "github-setup",
    "slack-setup",
    "web-search",
    "deploying",
    "success",
  ];

  // Effective agent ID and name - may be undefined if agent not yet created
  const effectiveAgentId = agentInfo?.id;
  const effectiveAgentName = agentInfo?.name ?? agentName;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 py-12">
      <ProgressIndicator
        steps={steps.slice(0, -1)} // Exclude success from progress
        currentStep={state.currentStep}
        onStepClick={(step) => goToStep(step as OnboardingStep)}
        welcomeOnly={!effectiveAgentId}
      />

      <div className="flex w-full flex-1 items-center">
        {state.currentStep === "welcome" && (
          <WelcomeStep
            onContinue={() => goToStep("llm-api-keys")}
            client={client}
            organizationId={organizationId}
            existingAgentId={effectiveAgentId}
            onAgentCreated={handleAgentCreated}
            agentName={agentName}
          />
        )}

        {state.currentStep === "llm-api-keys" && (
          <LlmApiKeysStep
            initialValues={state.llm}
            onContinue={(values) => {
              updateOnboardingState({
                llm: { ...state.llm, ...values },
                currentStep: "github-setup",
              });
            }}
            onSkip={() => goToStep("github-setup")}
            onBack={() => goToStep("welcome")}
          />
        )}

        {state.currentStep === "github-setup" && effectiveAgentId && (
          <GitHubSetupStep
            agentId={effectiveAgentId}
            agentName={effectiveAgentName}
            onComplete={(github) => {
              updateOnboardingState({ github, currentStep: "slack-setup" });
            }}
            onSkip={() => goToStep("slack-setup")}
            onBack={() => goToStep("llm-api-keys")}
          />
        )}

        {state.currentStep === "slack-setup" && effectiveAgentId && (
          <SlackSetupStep
            agentId={effectiveAgentId}
            agentName={effectiveAgentName}
            onComplete={(slack) => {
              updateOnboardingState({ slack, currentStep: "web-search" });
            }}
            onSkip={() => goToStep("web-search")}
            onBack={() => goToStep("github-setup")}
          />
        )}

        {state.currentStep === "web-search" && (
          <WebSearchStep
            initialValue={state.webSearch?.apiKey}
            onContinue={(apiKey) => {
              updateOnboardingState({
                webSearch: { provider: "exa", apiKey },
                currentStep: "deploying",
              });
            }}
            onSkip={() => goToStep("deploying")}
            onBack={() => goToStep("slack-setup")}
          />
        )}

        {state.currentStep === "deploying" && effectiveAgentId && (
          <DeployingStep
            organizationId={organizationId}
            agentId={effectiveAgentId}
            slack={state.slack}
            llm={state.llm}
            webSearch={state.webSearch}
            github={state.github}
            goToStep={goToStep}
            onSuccess={() => {
              goToStep("success");
            }}
          />
        )}

        {state.currentStep === "success" && (
          <SuccessStep
            agentName={effectiveAgentName}
            onFinish={clearAndRedirect}
          />
        )}
      </div>
    </div>
  );
}
