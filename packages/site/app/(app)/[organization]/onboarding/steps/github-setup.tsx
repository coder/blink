"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type Client from "@blink.so/api";
import { ArrowLeft, Check, Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface GitHubSetupStepProps {
  client: Client;
  initialValues?: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
  };
  onContinue: (values: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
  }) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function GitHubSetupStep({
  client,
  initialValues,
  onContinue,
  onSkip,
  onBack,
}: GitHubSetupStepProps) {
  const [appId, setAppId] = useState(initialValues?.appId || "");
  const [privateKey, setPrivateKey] = useState(initialValues?.privateKey || "");
  const [webhookSecret, setWebhookSecret] = useState(
    initialValues?.webhookSecret || ""
  );
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);

  const handleValidate = async () => {
    if (!appId || !privateKey) {
      toast.error("App ID and Private Key are required");
      return;
    }

    setValidating(true);
    try {
      const result = await client.onboarding.validateCredentials({
        type: "github",
        credentials: { appId, privateKey },
      });

      if (result.valid) {
        setValidated(true);
        toast.success("GitHub credentials validated");
      } else {
        toast.error(result.error || "Invalid credentials");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Validation failed"
      );
    } finally {
      setValidating(false);
    }
  };

  const handleContinue = () => {
    if (!validated && (appId || privateKey)) {
      toast.error("Please validate your credentials first");
      return;
    }
    onContinue({ appId, privateKey, webhookSecret });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          <CardTitle>GitHub App Setup</CardTitle>
        </div>
        <CardDescription>
          Connect a GitHub App to enable PR reviews, issue responses, and
          webhooks.{" "}
          <a
            href="https://docs.github.com/en/apps/creating-github-apps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Learn how to create a GitHub App
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="github-app-id">App ID</Label>
          <Input
            id="github-app-id"
            placeholder="123456"
            value={appId}
            onChange={(e) => {
              setAppId(e.target.value);
              setValidated(false);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="github-private-key">Private Key</Label>
          <Textarea
            id="github-private-key"
            placeholder="-----BEGIN RSA PRIVATE KEY-----..."
            value={privateKey}
            onChange={(e) => {
              setPrivateKey(e.target.value);
              setValidated(false);
            }}
            rows={6}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="github-webhook-secret">
            Webhook Secret{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="github-webhook-secret"
            type="password"
            placeholder="your-webhook-secret"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleValidate}
            disabled={validating || !appId || !privateKey}
          >
            {validating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : validated ? (
              <Check className="mr-2 h-4 w-4 text-green-500" />
            ) : null}
            {validated ? "Validated" : "Validate"}
          </Button>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip}>
              Skip
            </Button>
            <Button onClick={handleContinue}>Continue</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
