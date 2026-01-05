"use client";

import { Key } from "lucide-react";
import {
  getEnvVarKeyForProvider,
  type LlmApiKeysResult,
  LlmApiKeysSetup,
} from "@/components/llm-api-keys-setup";
import { EnvVarConfirmation } from "./env-var-confirmation";
import { useIntegrationSetup } from "./use-integration-setup";

interface LlmIntegrationProps {
  agentId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function LlmIntegration({
  agentId,
  onComplete,
  onCancel,
}: LlmIntegrationProps) {
  const {
    step,
    setStep,
    setupResult,
    envVars,
    setEnvVars,
    saving,
    handleSave,
    handleSetupComplete,
  } = useIntegrationSetup<LlmApiKeysResult>({
    agentId,
    onComplete,
    integrationKey: "llm",
    successMessage: "LLM API key configured successfully",
  });

  const onSetupComplete = (result: LlmApiKeysResult) => {
    const envVarKey = getEnvVarKeyForProvider(result.provider);
    handleSetupComplete(result, [
      {
        defaultKey: envVarKey,
        currentKey: envVarKey,
        value: result.apiKey,
        secret: true,
      },
    ]);
  };

  if (step === "confirm") {
    return (
      <EnvVarConfirmation
        title="LLM API Key"
        description="Save your LLM API key as an environment variable"
        icon={<Key className="h-5 w-5 text-white" />}
        iconBgColor="bg-amber-500"
        envVars={envVars}
        onEnvVarsChange={setEnvVars}
        onSave={handleSave}
        onCancel={onCancel}
        onBack={() => setStep("setup")}
        saving={saving}
      />
    );
  }

  return (
    <LlmApiKeysSetup
      initialValues={
        setupResult
          ? { provider: setupResult.provider, apiKey: setupResult.apiKey }
          : undefined
      }
      onComplete={onSetupComplete}
      onBack={onCancel}
    />
  );
}
