"use client";

import { ArrowRight, Github } from "lucide-react";
import { useState } from "react";
import {
  type GitHubAppCredentials,
  GitHubSetupWizard,
} from "@/components/github-setup-wizard";
import { OnboardingStepFooter } from "@/components/onboarding-step-footer";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface GitHubSetupResult {
  appName: string;
  appUrl: string;
  installUrl: string;
  appId: number;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKey: string;
}

interface GitHubSetupStepProps {
  agentId: string;
  agentName: string;
  onComplete: (result: GitHubSetupResult) => void;
  onSkip: () => void;
  onBack?: () => void;
}

export function GitHubSetupStep({
  agentId,
  agentName,
  onComplete,
  onSkip,
  onBack,
}: GitHubSetupStepProps) {
  const [showWizard, setShowWizard] = useState(false);

  const handleWizardComplete = (result: {
    appName: string;
    appUrl: string;
    installUrl: string;
    credentials: GitHubAppCredentials;
  }) => {
    onComplete({
      appName: result.appName,
      appUrl: result.appUrl,
      installUrl: result.installUrl,
      appId: result.credentials.appId,
      clientId: result.credentials.clientId,
      clientSecret: result.credentials.clientSecret,
      webhookSecret: result.credentials.webhookSecret,
      privateKey: result.credentials.privateKey,
    });
  };

  if (!showWizard) {
    return (
      <Card className="w-full">
        <CardContent className="flex flex-col items-center pt-8 pb-6 text-center">
          <OnboardingStepHeader
            icon={Github}
            iconBgClassName="bg-[#24292f]"
            iconClassName="text-white"
            title="Connect to GitHub"
            description="Create a GitHub App to enable PR reviews, issue responses, and repository access."
          />
          <Button className="mt-8 w-64" onClick={() => setShowWizard(true)}>
            Create GitHub App
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            You can also set this up later in Settings &gt; Integrations
          </p>
          <OnboardingStepFooter
            onBack={onBack}
            onSkip={onSkip}
            className="mt-6 w-full border-t-0 pt-0"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <GitHubSetupWizard
      agentId={agentId}
      agentName={agentName}
      onComplete={handleWizardComplete}
      onBack={() => setShowWizard(false)}
      onSkip={onSkip}
    />
  );
}
