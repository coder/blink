"use client";

import { SlackSetupWizard } from "@/components/slack-setup-wizard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAPIClient } from "@/lib/api-client";
import { Check, MessageSquare, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface IntegrationsManagerProps {
  agentId: string;
  agentName: string;
  organizationId: string;
}

export default function IntegrationsManager({
  agentId,
  agentName,
}: IntegrationsManagerProps) {
  const client = useAPIClient();
  const [showSlackSetup, setShowSlackSetup] = useState(false);
  const [slackConfigured, setSlackConfigured] = useState(false);

  if (showSlackSetup) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium">Slack Integration</h3>
          <p className="text-sm text-muted-foreground">
            Connect your agent to Slack to chat with it directly in your
            workspace.
          </p>
        </div>
        <SlackSetupWizard
          client={client}
          agentId={agentId}
          agentName={agentName}
          onComplete={() => {
            setSlackConfigured(true);
            setShowSlackSetup(false);
            toast.success("Slack integration configured successfully");
          }}
          onCancel={() => setShowSlackSetup(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Integrations</h3>
        <p className="text-sm text-muted-foreground">
          Connect your agent to external services to extend its capabilities.
        </p>
      </div>
      <div className="grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4A154B]">
                  <MessageSquare className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-base">Slack</CardTitle>
                  <CardDescription className="text-sm">
                    Chat with your agent in Slack
                  </CardDescription>
                </div>
              </div>
              {slackConfigured ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  Connected
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSlackSetup(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Configure
                </Button>
              )}
            </div>
          </CardHeader>
          {slackConfigured && (
            <CardContent className="pt-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSlackSetup(true)}
              >
                Reconfigure
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
