"use client";

import {
  type GitHubAppCredentials,
  GitHubSetupWizard,
} from "@/components/github-setup-wizard";
import { GitHubIcon } from "@/components/icons/github";
import { EnvVarConfirmation } from "./env-var-confirmation";
import { useIntegrationSetup } from "./use-integration-setup";

interface GitHubSetupResult {
  appName: string;
  appUrl: string;
  installUrl: string;
  credentials: GitHubAppCredentials;
}

interface GitHubIntegrationProps {
  agentId: string;
  agentName: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function GitHubIntegration({
  agentId,
  agentName,
  onComplete,
  onCancel,
}: GitHubIntegrationProps) {
  const {
    step,
    setStep,
    envVars,
    setEnvVars,
    saving,
    handleSave,
    handleSetupComplete,
  } = useIntegrationSetup<GitHubSetupResult>({
    agentId,
    onComplete,
    integrationKey: "github",
    successMessage: "GitHub integration configured successfully",
  });

  const onSetupComplete = (result: {
    appName: string;
    appUrl: string;
    installUrl: string;
    credentials: GitHubAppCredentials;
  }) => {
    handleSetupComplete(result, [
      {
        defaultKey: "GITHUB_APP_ID",
        currentKey: "GITHUB_APP_ID",
        value: String(result.credentials.appId),
        secret: false,
      },
      {
        defaultKey: "GITHUB_CLIENT_ID",
        currentKey: "GITHUB_CLIENT_ID",
        value: result.credentials.clientId,
        secret: false,
      },
      {
        defaultKey: "GITHUB_CLIENT_SECRET",
        currentKey: "GITHUB_CLIENT_SECRET",
        value: result.credentials.clientSecret,
        secret: true,
      },
      {
        defaultKey: "GITHUB_WEBHOOK_SECRET",
        currentKey: "GITHUB_WEBHOOK_SECRET",
        value: result.credentials.webhookSecret,
        secret: true,
      },
      {
        defaultKey: "GITHUB_PRIVATE_KEY",
        currentKey: "GITHUB_PRIVATE_KEY",
        value: result.credentials.privateKey,
        secret: true,
      },
    ]);
  };

  if (step === "confirm") {
    return (
      <EnvVarConfirmation
        title="GitHub App"
        description="Save your GitHub App credentials as environment variables"
        icon={<GitHubIcon className="h-5 w-5 text-white" />}
        iconBgColor="bg-[#24292f]"
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
    <GitHubSetupWizard
      agentId={agentId}
      agentName={agentName}
      onComplete={onSetupComplete}
      onBack={onCancel}
    />
  );
}
