"use client";

import { SlackIcon } from "@/components/slack-icon";
import { SlackSetupWizard } from "@/components/slack-setup-wizard";
import { EnvVarConfirmation } from "./env-var-confirmation";
import { useIntegrationSetup } from "./use-integration-setup";

interface SlackCredentials {
  botToken: string;
  signingSecret: string;
}

interface SlackIntegrationProps {
  agentId: string;
  agentName: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function SlackIntegration({
  agentId,
  agentName,
  onComplete,
  onCancel,
}: SlackIntegrationProps) {
  const {
    step,
    setStep,
    envVars,
    setEnvVars,
    saving,
    handleSave,
    handleSetupComplete,
  } = useIntegrationSetup<SlackCredentials>({
    agentId,
    onComplete,
    integrationKey: "slack",
    successMessage: "Slack integration configured successfully",
  });

  const onSetupComplete = (result: SlackCredentials) => {
    handleSetupComplete(result, [
      {
        defaultKey: "SLACK_BOT_TOKEN",
        currentKey: "SLACK_BOT_TOKEN",
        value: result.botToken,
        secret: true,
      },
      {
        defaultKey: "SLACK_SIGNING_SECRET",
        currentKey: "SLACK_SIGNING_SECRET",
        value: result.signingSecret,
        secret: true,
      },
    ]);
  };

  if (step === "confirm") {
    return (
      <EnvVarConfirmation
        title="Slack"
        description="Save your Slack credentials as environment variables"
        icon={<SlackIcon className="h-5 w-5 text-white" />}
        iconBgColor="bg-[#4A154B]"
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
    <SlackSetupWizard
      agentId={agentId}
      agentName={agentName}
      onComplete={onSetupComplete}
      onBack={onCancel}
    />
  );
}
