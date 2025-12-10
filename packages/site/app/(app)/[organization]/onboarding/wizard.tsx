"use client";

import { useAPIClient } from "@/lib/api-client";
import type Client from "@blink.so/api";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProgressIndicator } from "./components/progress-indicator";
import { WelcomeStep } from "./steps/welcome";
import { GitHubSetupStep } from "./steps/github-setup";
import { SlackSetupStep } from "./steps/slack-setup";
import { ApiKeysStep } from "./steps/api-keys";
import { DeployingStep } from "./steps/deploying";
import { SuccessStep } from "./steps/success";

export type OnboardingStep =
  | "welcome"
  | "github-setup"
  | "slack-setup"
  | "api-keys"
  | "deploying"
  | "success";

export interface OnboardingState {
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
  agentName: "Scout",
};

function OnboardingWizardInner({
  organizationId,
  organizationName,
  client,
  initialState,
}: {
  organizationId: string;
  organizationName: string;
  client: Client;
  /** Optional initial state for testing/stories - bypasses localStorage */
  initialState?: Partial<OnboardingState>;
}) {
  const router = useRouter();
  const skipPersistence = initialState !== undefined;

  const [state, setState] = useState<OnboardingState>(() => {
    // If initialState is provided, use it (for stories/testing)
    if (initialState) {
      return { ...defaultState, ...initialState };
    }
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

  // Persist state to localStorage (skip when using initialState for stories)
  useEffect(() => {
    if (skipPersistence) return;
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${organizationId}`,
      JSON.stringify(state)
    );
  }, [state, organizationId, skipPersistence]);

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
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 py-12">
      <ProgressIndicator
        steps={steps.slice(0, -1)} // Exclude success from progress
        currentStep={state.currentStep}
      />

      <div className="flex w-full flex-1 items-center">
        {state.currentStep === "welcome" && (
          <WelcomeStep
            onContinue={() => goToStep("github-setup")}
            client={client}
            organizationId={organizationId}
            onFileDownloaded={(fileId) => updateState({ fileId })}
            onAgentCreated={(agentId) => updateState({ agentId })}
            existingFileId={state.fileId}
            existingAgentId={state.agentId}
            agentName={state.agentName}
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

        {state.currentStep === "slack-setup" && state.agentId && (
          <SlackSetupStep
            client={client}
            agentId={state.agentId}
            agentName={state.agentName}
            onComplete={(slack) => {
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

        {state.currentStep === "deploying" && state.agentId && (
          <DeployingStep
            client={client}
            organizationId={organizationId}
            fileId={state.fileId!}
            agentId={state.agentId}
            agentName={state.agentName}
            github={state.github}
            slack={state.slack}
            apiKeys={state.apiKeys}
            onSuccess={() => {
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

/**
 * OnboardingWizard with client injection support for testing.
 * When client is provided, useAPIClient() is not called.
 */
export function OnboardingWizard({
  organizationId,
  organizationName,
  client,
  initialState,
}: {
  organizationId: string;
  organizationName: string;
  /** Optional client for testing/stories */
  client?: Client;
  /** Optional initial state for testing/stories - bypasses localStorage */
  initialState?: Partial<OnboardingState>;
}) {
  if (client) {
    return (
      <OnboardingWizardInner
        organizationId={organizationId}
        organizationName={organizationName}
        client={client}
        initialState={initialState}
      />
    );
  }

  return (
    <OnboardingWizardWithHook
      organizationId={organizationId}
      organizationName={organizationName}
    />
  );
}

function OnboardingWizardWithHook({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const client = useAPIClient();

  return (
    <OnboardingWizardInner
      organizationId={organizationId}
      organizationName={organizationName}
      client={client}
    />
  );
}
