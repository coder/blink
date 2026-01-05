"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SuccessStepProps {
  agentName: string;
  onFinish: () => void;
}

export function SuccessStep({ agentName, onFinish }: SuccessStepProps) {
  return (
    <div className="w-full">
      <Card>
        <CardContent className="pt-8 pb-6 space-y-4">
          <OnboardingStepHeader
            icon={CheckCircle2}
            iconBgClassName="bg-green-500/10"
            iconClassName="text-green-500"
            title="Agent Deployed!"
            description={
              <>
                Your agent <strong>{agentName}</strong> has been successfully
                deployed and is ready to use.
              </>
            }
            size="lg"
          />
          <div className="rounded-lg bg-muted p-4">
            <h4 className="font-medium mb-2">Next Steps</h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>Start a chat with your agent to test it out</li>
              <li>Configure additional environment variables in settings</li>
              <li>Set up webhooks for GitHub and Slack integrations</li>
            </ul>
          </div>

          <Button onClick={onFinish} className="w-full" size="lg">
            Go to Agent
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
