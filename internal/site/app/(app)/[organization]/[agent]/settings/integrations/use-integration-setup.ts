"use client";

import type { IntegrationsState } from "@blink.so/api";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAPIClient } from "@/lib/api-client";
import type { EnvVarConfig } from "./env-var-confirmation";

type SetupStep = "setup" | "confirm";

interface UseIntegrationSetupOptions {
  agentId: string;
  onComplete: () => void;

  /** The integration key to set in integrations_state */
  integrationKey: keyof IntegrationsState;

  /** Success message to show */
  successMessage: string;
}

interface UseIntegrationSetupReturn<TSetupResult> {
  step: SetupStep;
  setStep: (step: SetupStep) => void;
  setupResult: TSetupResult | null;
  setSetupResult: (result: TSetupResult | null) => void;
  envVars: EnvVarConfig[];
  setEnvVars: (envVars: EnvVarConfig[]) => void;
  saving: boolean;
  handleSave: () => Promise<void>;
  handleSetupComplete: (result: TSetupResult, envVars: EnvVarConfig[]) => void;
}

export function useIntegrationSetup<TSetupResult>({
  agentId,
  onComplete,
  integrationKey,
  successMessage,
}: UseIntegrationSetupOptions): UseIntegrationSetupReturn<TSetupResult> {
  const client = useAPIClient();

  const [step, setStep] = useState<SetupStep>("setup");
  const [setupResult, setSetupResult] = useState<TSetupResult | null>(null);
  const [envVars, setEnvVars] = useState<EnvVarConfig[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSetupComplete = useCallback(
    (result: TSetupResult, newEnvVars: EnvVarConfig[]) => {
      setSetupResult(result);
      setEnvVars(newEnvVars);
      setStep("confirm");
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!setupResult) return;

    setSaving(true);
    try {
      // Save env vars
      await Promise.all(
        envVars.map((envVar) =>
          client.agents.env.create({
            agent_id: agentId,
            key: envVar.currentKey,
            value: envVar.value,
            secret: envVar.secret,
            target: ["preview", "production"],
            upsert: true,
          })
        )
      );

      // Update integrations_state
      await client.agents.updateIntegrationsState(agentId, {
        [integrationKey]: true,
      });

      toast.success(successMessage);
      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save environment variables"
      );
    } finally {
      setSaving(false);
    }
  }, [
    agentId,
    client,
    envVars,
    onComplete,
    setupResult,
    integrationKey,
    successMessage,
  ]);

  return {
    step,
    setStep,
    setupResult,
    setSetupResult,
    envVars,
    setEnvVars,
    saving,
    handleSave,
    handleSetupComplete,
  };
}
