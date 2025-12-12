"use client";

import { GitHubSetupWizard } from "@/components/github-setup-wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type Client from "@blink.so/api";
import { ArrowLeft, ArrowRight, Github } from "lucide-react";
import { useState } from "react";

interface GitHubSetupStepProps {
  client: Client;
  agentId: string;
  agentName: string;
  onComplete: (result: {
    appName: string;
    appUrl: string;
    installUrl: string;
  }) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function GitHubSetupStep({
  client,
  agentId,
  agentName,
  onComplete,
  onSkip,
  onBack,
}: GitHubSetupStepProps) {
  const [showWizard, setShowWizard] = useState(false);

  if (!showWizard) {
    return (
      <Card className="w-full">
        <CardContent className="flex flex-col items-center pt-8 pb-6 text-center">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#24292f]">
            <Github className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-xl font-semibold">Connect to GitHub</h2>
          <p className="mt-2 text-muted-foreground">
            Create a GitHub App to enable PR reviews, issue responses, and
            repository access.
          </p>
          <Button className="mt-8 w-64" onClick={() => setShowWizard(true)}>
            Create GitHub App
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            You can also set this up later in Settings &gt; Integrations
          </p>
          <div className="mt-6 flex w-full justify-between">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button variant="outline" onClick={onSkip}>
              Skip
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <GitHubSetupWizard
      client={client}
      agentId={agentId}
      agentName={agentName}
      onComplete={onComplete}
      onCancel={onSkip}
      onBack={() => setShowWizard(false)}
      onSkip={onSkip}
    />
  );
}
