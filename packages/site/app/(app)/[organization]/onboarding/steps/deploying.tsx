"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type Client from "@blink.so/api";
import { Loader2, Rocket, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface DeployingStepProps {
  client: Client;
  organizationId: string;
  fileId: string;
  agentName: string;
  github?: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
  };
  slack?: {
    botToken: string;
    signingSecret: string;
  };
  apiKeys?: {
    aiProvider?: "anthropic" | "openai" | "vercel";
    aiApiKey?: string;
    exaApiKey?: string;
  };
  onSuccess: (agentId: string) => void;
  onError: () => void;
}

export function DeployingStep({
  client,
  organizationId,
  fileId,
  agentName,
  github,
  slack,
  apiKeys,
  onSuccess,
  onError,
}: DeployingStepProps) {
  const [status, setStatus] = useState<"deploying" | "error">("deploying");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);

    const deploy = async () => {
      try {
        // Build environment variables
        const env: Array<{ key: string; value: string; secret: boolean }> = [];

        if (github?.appId) {
          env.push({ key: "GITHUB_APP_ID", value: github.appId, secret: false });
        }
        if (github?.privateKey) {
          env.push({
            key: "GITHUB_APP_PRIVATE_KEY",
            value: Buffer.from(github.privateKey).toString("base64"),
            secret: true,
          });
        }
        if (github?.webhookSecret) {
          env.push({
            key: "GITHUB_WEBHOOK_SECRET",
            value: github.webhookSecret,
            secret: true,
          });
        }
        if (slack?.botToken) {
          env.push({
            key: "SLACK_BOT_TOKEN",
            value: slack.botToken,
            secret: true,
          });
        }
        if (slack?.signingSecret) {
          env.push({
            key: "SLACK_SIGNING_SECRET",
            value: slack.signingSecret,
            secret: true,
          });
        }
        if (apiKeys?.exaApiKey) {
          env.push({
            key: "EXA_API_KEY",
            value: apiKeys.exaApiKey,
            secret: true,
          });
        }
        // Set the appropriate API key based on the selected provider
        if (apiKeys?.aiApiKey && apiKeys?.aiProvider) {
          const envKeyMap: Record<string, string> = {
            anthropic: "ANTHROPIC_API_KEY",
            openai: "OPENAI_API_KEY",
            vercel: "AI_GATEWAY_API_KEY",
          };
          env.push({
            key: envKeyMap[apiKeys.aiProvider],
            value: apiKeys.aiApiKey,
            secret: true,
          });
        }

        const result = await client.onboarding.deployAgent({
          organization_id: organizationId,
          name: agentName,
          file_id: fileId,
          env,
        });

        onSuccess(result.id);
      } catch (error) {
        setStatus("error");
        const message =
          error instanceof Error ? error.message : "Deployment failed";
        setErrorMessage(message);
        toast.error(message);
      }
    };

    deploy();
  }, [
    hasStarted,
    client,
    organizationId,
    fileId,
    agentName,
    github,
    slack,
    apiKeys,
    onSuccess,
  ]);

  if (status === "error") {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Deployment Failed</CardTitle>
          <CardDescription className="text-base">
            {errorMessage || "Something went wrong during deployment."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={onError}>Go Back</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Rocket className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">Deploying Your Agent</CardTitle>
        <CardDescription className="text-base">
          This may take a moment. Please don&apos;t close this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </CardContent>
    </Card>
  );
}
