"use client";

import { Search } from "lucide-react";
import {
  EXA_ENV_VAR_KEY,
  type WebSearchResult,
  WebSearchSetup,
} from "@/components/web-search-setup";
import { EnvVarConfirmation } from "./env-var-confirmation";
import { useIntegrationSetup } from "./use-integration-setup";

interface WebSearchIntegrationProps {
  agentId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function WebSearchIntegration({
  agentId,
  onComplete,
  onCancel,
}: WebSearchIntegrationProps) {
  const {
    step,
    setStep,
    setupResult,
    envVars,
    setEnvVars,
    saving,
    handleSave,
    handleSetupComplete,
  } = useIntegrationSetup<WebSearchResult>({
    agentId,
    onComplete,
    integrationKey: "webSearch",
    successMessage: "Web search configured successfully",
  });

  const onSetupComplete = (result: WebSearchResult) => {
    handleSetupComplete(result, [
      {
        defaultKey: EXA_ENV_VAR_KEY,
        currentKey: EXA_ENV_VAR_KEY,
        value: result.exaApiKey,
        secret: true,
      },
    ]);
  };

  if (step === "confirm") {
    return (
      <EnvVarConfirmation
        title="Web Search (Exa)"
        description="Save your Exa API key as an environment variable"
        icon={<Search className="h-5 w-5 text-white" />}
        iconBgColor="bg-blue-500"
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
    <WebSearchSetup
      initialValue={setupResult?.exaApiKey}
      onComplete={onSetupComplete}
      onBack={onCancel}
    />
  );
}
