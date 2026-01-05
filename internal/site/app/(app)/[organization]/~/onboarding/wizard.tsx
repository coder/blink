"use client";

import type { OnboardingState } from "@blink.so/api";
import { useAPIClient } from "@/lib/api-client";
import { type AgentInfo, WizardContent } from "./components/wizard-content";

export type { AgentInfo, OnboardingState };
export type OnboardingStep = OnboardingState["currentStep"];

export function OnboardingWizard({
  organizationId,
  organizationName,
  agent,
}: {
  organizationId: string;
  organizationName: string;
  /** Agent with existing onboarding state (for resuming onboarding) */
  agent?: AgentInfo;
}) {
  const client = useAPIClient();

  return (
    <WizardContent
      organizationId={organizationId}
      organizationName={organizationName}
      client={client}
      initialAgent={agent}
    />
  );
}
