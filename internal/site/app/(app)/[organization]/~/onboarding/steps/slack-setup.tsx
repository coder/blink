"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { OnboardingStepFooter } from "@/components/onboarding-step-footer";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { SlackIcon } from "@/components/slack-icon";
import { SlackSetupWizard } from "@/components/slack-setup-wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SlackSetupStepProps {
  agentId: string;
  agentName: string;
  onComplete: (slack: { botToken: string; signingSecret: string }) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function SlackSetupStep({
  agentId,
  agentName,
  onComplete,
  onSkip,
  onBack,
}: SlackSetupStepProps) {
  const [showWizard, setShowWizard] = useState(false);

  if (!showWizard) {
    return (
      <Card className="w-full">
        <CardContent className="flex flex-col items-center pt-8 pb-6 text-center">
          <OnboardingStepHeader
            icon={SlackIcon}
            iconBgClassName="bg-[#4A154B]"
            iconClassName="text-white"
            title="Connect to Slack"
            description="Let your agent respond to messages in Slack channels and DMs."
          />
          <Button className="mt-8 w-64" onClick={() => setShowWizard(true)}>
            Connect to Slack
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
    <SlackSetupWizard
      agentId={agentId}
      agentName={agentName}
      onComplete={onComplete}
      onBack={() => setShowWizard(false)}
      onSkip={onSkip}
    />
  );
}
