"use client";

import { useAPIClient } from "@/lib/api-client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProgressIndicator } from "./components/progress-indicator";
import { WelcomeStep } from "./steps/welcome";
import { GitHubSetupStep } from "./steps/github-setup";
import { SlackSetupStep } from "./steps/slack-setup";
import { ApiKeysStep } from "./steps/api-keys";
import { DeployingStep } from "./steps/deploying";
import { SuccessStep } from "./steps/success";

type OnboardingStep =
  | "welcome"
  | "github-setup"
  | "slack-setup"
  | "api-keys"
  | "deploying"
  | "success";

interface OnboardingState {
  currentStep: OnboardingStep;
  fileId?: string;
  github?: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
  };
  slack?: {
    botToken: string;
    signingSecret: string;
  };
  apiKeys?: {
    aiProvider?: "anthropic" | "openai" | "vercel";
    aiApiKey?: string;
    exaApiKey?: string;
  };
  agentName: string;
  agentId?: string;
}

const STORAGE_KEY_PREFIX = "onboarding:";

const defaultState: OnboardingState = {
  currentStep: "welcome",
  agentName: "scout",
};

export function OnboardingWizard({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const client = useAPIClient();

  const [state, setState] = useState<OnboardingState>(() => {
    if (typeof window === "undefined") {
      return defaultState;
    }
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${organizationId}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return defaultState;
      }
    }
    return defaultState;
  });

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${organizationId}`,
      JSON.stringify(state)
    );
  }, [state, organizationId]);

  const goToStep = useCallback((step: OnboardingStep) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const updateState = useCallback((updates: Partial<OnboardingState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const clearAndRedirect = useCallback(() => {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${organizationId}`);
    router.push(`/${organizationName}/${state.agentName}`);
  }, [organizationId, organizationName, state.agentName, router]);

  const steps: OnboardingStep[] = [
    "welcome",
    "github-setup",
    "slack-setup",
    "api-keys",
    "deploying",
    "success",
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <ProgressIndicator
        steps={steps.slice(0, -1)} // Exclude success from progress
        currentStep={state.currentStep}
      />

      <div className="mt-8">
        {state.currentStep === "welcome" && (
          <WelcomeStep
            onContinue={() => goToStep("github-setup")}
            client={client}
            organizationId={organizationId}
            onFileDownloaded={(fileId) => updateState({ fileId })}
            existingFileId={state.fileId}
          />
        )}

        {state.currentStep === "github-setup" && (
          <GitHubSetupStep
            client={client}
            initialValues={state.github}
            onContinue={(github) => {
              updateState({ github });
              goToStep("slack-setup");
            }}
            onSkip={() => goToStep("slack-setup")}
            onBack={() => goToStep("welcome")}
          />
        )}

        {state.currentStep === "slack-setup" && (
          <SlackSetupStep
            client={client}
            initialValues={state.slack}
            onContinue={(slack) => {
              updateState({ slack });
              goToStep("api-keys");
            }}
            onSkip={() => goToStep("api-keys")}
            onBack={() => goToStep("github-setup")}
          />
        )}

        {state.currentStep === "api-keys" && (
          <ApiKeysStep
            initialValues={state.apiKeys}
            onContinue={(apiKeys) => {
              updateState({ apiKeys });
              goToStep("deploying");
            }}
            onSkip={() => goToStep("deploying")}
            onBack={() => goToStep("slack-setup")}
          />
        )}

        {state.currentStep === "deploying" && (
          <DeployingStep
            client={client}
            organizationId={organizationId}
            fileId={state.fileId!}
            agentName={state.agentName}
            github={state.github}
            slack={state.slack}
            apiKeys={state.apiKeys}
            onSuccess={(agentId) => {
              updateState({ agentId });
              goToStep("success");
            }}
            onError={() => goToStep("api-keys")}
          />
        )}

        {state.currentStep === "success" && (
          <SuccessStep
            agentName={state.agentName}
            organizationName={organizationName}
            onFinish={clearAndRedirect}
          />
        )}
      </div>
    </div>
  );
}
