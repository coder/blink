"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, ArrowRight } from "lucide-react";

interface SuccessStepProps {
  agentName: string;
  organizationName: string;
  onFinish: () => void;
}

export function SuccessStep({
  agentName,
  organizationName,
  onFinish,
}: SuccessStepProps) {
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
        </div>
        <CardTitle className="text-2xl">Agent Deployed!</CardTitle>
        <CardDescription className="text-base">
          Your agent <strong>{agentName}</strong> has been successfully deployed
          and is ready to use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
  );
}
