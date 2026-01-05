"use client";

import type { OnboardingState } from "@blink.so/api";
import { useAPIClient } from "@/lib/api-client";
import { type AgentInfo, WizardContent } from "../components/wizard-content";

export type { OnboardingState };
export type OnboardingStep = OnboardingState["currentStep"];

export function AgentOnboardingWizard({
  organizationId,
  organizationName,
  agentName,
  agent,
}: {
  organizationId: string;
  organizationName: string;
  agentName: string;
  /** Existing agent (for resuming onboarding) */
  agent?: AgentInfo;
}) {
  const client = useAPIClient();

  return (
    <WizardContent
      organizationId={organizationId}
      organizationName={organizationName}
      agentName={agentName}
      client={client}
      initialAgent={agent}
    />
  );
}
