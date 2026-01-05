"use client";

import { ExternalLink, Info, Search } from "lucide-react";
import { useState } from "react";
import { OnboardingStepFooter } from "@/components/onboarding-step-footer";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupStep } from "@/components/ui/setup-step";

export interface WebSearchResult {
  exaApiKey: string;
}

export interface WebSearchSetupProps {
  initialValue?: string;
  onComplete: (result: WebSearchResult) => void;
  onBack?: () => void;
  onSkip?: () => void;
  completing?: boolean;
}

export const EXA_ENV_VAR_KEY = "EXA_API_KEY";

export function WebSearchSetup({
  initialValue,
  onComplete,
  onBack,
  onSkip,
  completing,
}: WebSearchSetupProps) {
  const [exaApiKey, setExaApiKey] = useState(initialValue || "");
  const [hasOpenedKeyPage, setHasOpenedKeyPage] = useState(false);

  const handleComplete = () => {
    if (exaApiKey.trim()) {
      onComplete({ exaApiKey: exaApiKey.trim() });
    }
  };

  return (
    <Card className="w-full">
      <OnboardingStepHeader
        icon={Search}
        title="Web Search Setup"
        description="Enable web search capabilities for your agent via Exa."
        layout="inline"
      />
      <CardContent className="space-y-6">
        <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-3">
          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Exa is a web search provider for AI agents.{" "}
            <a
              href="https://exa.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Learn more
            </a>
          </p>
        </div>

        {/* Step 1: Create API Key */}
        <SetupStep
          num={1}
          active={!exaApiKey.trim()}
          completed={hasOpenedKeyPage || !!exaApiKey.trim()}
          headline="Create an Exa API key"
        >
          <Button
            variant={
              hasOpenedKeyPage || exaApiKey.trim() ? "outline" : "default"
            }
            size="sm"
            disabled={completing}
            onClick={() => {
              window.open("https://dashboard.exa.ai/api-keys", "_blank");
              setHasOpenedKeyPage(true);
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Create Exa API Key
          </Button>
        </SetupStep>

        {/* Step 2: Enter API Key */}
        <SetupStep
          num={2}
          active={true}
          completed={!!exaApiKey.trim()}
          headline={
            <Label htmlFor="exa-api-key" className="font-normal leading-6">
              Paste your <span className="font-semibold">API key</span>
            </Label>
          }
        >
          <Input
            id="exa-api-key"
            type="text"
            placeholder="Exa API Key"
            value={exaApiKey}
            onChange={(e) => setExaApiKey(e.target.value)}
            disabled={completing}
            data-1p-ignore
            autoComplete="off"
          />
        </SetupStep>

        <OnboardingStepFooter
          onBack={onBack}
          onSkip={onSkip}
          onContinue={handleComplete}
          continueDisabled={!exaApiKey.trim()}
          loading={completing}
        />
      </CardContent>
    </Card>
  );
}
