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
import type Client from "@blink.so/api";
import { ArrowLeft, Check, Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface SlackSetupStepProps {
  client: Client;
  initialValues?: {
    botToken: string;
    signingSecret: string;
  };
  onContinue: (values: { botToken: string; signingSecret: string }) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function SlackSetupStep({
  client,
  initialValues,
  onContinue,
  onSkip,
  onBack,
}: SlackSetupStepProps) {
  const [botToken, setBotToken] = useState(initialValues?.botToken || "");
  const [signingSecret, setSigningSecret] = useState(
    initialValues?.signingSecret || ""
  );
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);

  const handleValidate = async () => {
    if (!botToken) {
      toast.error("Bot Token is required");
      return;
    }

    setValidating(true);
    try {
      const result = await client.onboarding.validateCredentials({
        type: "slack",
        credentials: { botToken },
      });

      if (result.valid) {
        setValidated(true);
        toast.success("Slack credentials validated");
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
    if (!validated && botToken) {
      toast.error("Please validate your credentials first");
      return;
    }
    onContinue({ botToken, signingSecret });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          <CardTitle>Slack App Setup</CardTitle>
        </div>
        <CardDescription>
          Connect a Slack App to chat with your agent in Slack.{" "}
          <a
            href="https://api.slack.com/start/building"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Learn how to create a Slack App
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="slack-bot-token">Bot Token</Label>
          <Input
            id="slack-bot-token"
            type="password"
            placeholder="xoxb-..."
            value={botToken}
            onChange={(e) => {
              setBotToken(e.target.value);
              setValidated(false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Found under OAuth & Permissions in your Slack App settings
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slack-signing-secret">
            Signing Secret{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="slack-signing-secret"
            type="password"
            placeholder="your-signing-secret"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Found under Basic Information in your Slack App settings
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleValidate}
            disabled={validating || !botToken}
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
