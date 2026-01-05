"use client";

import { ExternalLink, Key } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type AIProvider,
  getEnvVarKeyForProvider,
  LLM_PROVIDERS,
} from "@/app/(app)/[organization]/~/onboarding/llm-providers";
import { OnboardingStepFooter } from "@/components/onboarding-step-footer";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupStep } from "@/components/ui/setup-step";
import { cn } from "@/lib/utils";

export type { AIProvider };
export { getEnvVarKeyForProvider };

export interface LlmApiKeysResult {
  provider: AIProvider;
  apiKey: string;
}

export interface LlmApiKeysSetupProps {
  initialValues?: {
    provider?: AIProvider;
    apiKey?: string;
  };
  onComplete: (result: LlmApiKeysResult) => void;
  onBack?: () => void;
  onSkip?: () => void;
  completing?: boolean;
}

export function LlmApiKeysSetup({
  initialValues,
  onComplete,
  onBack,
  onSkip,
  completing,
}: LlmApiKeysSetupProps) {
  const [aiProvider, setAIProvider] = useState<AIProvider | undefined>(
    initialValues?.provider
  );
  const [aiApiKey, setAIApiKey] = useState(initialValues?.apiKey || "");
  const [hasOpenedKeyPage, setHasOpenedKeyPage] = useState(false);

  const selectedProvider = LLM_PROVIDERS.find((p) => p.id === aiProvider);

  const currentStep = useMemo(() => {
    if (!aiProvider) return 1;
    if (!hasOpenedKeyPage) return 2;
    return 3;
  }, [aiProvider, hasOpenedKeyPage]);

  const handleComplete = () => {
    if (aiProvider && aiApiKey.trim()) {
      onComplete({
        provider: aiProvider,
        apiKey: aiApiKey.trim(),
      });
    }
  };

  const canComplete = aiProvider && aiApiKey.trim();

  return (
    <Card className="w-full">
      <OnboardingStepHeader
        icon={Key}
        title="LLM API Key Setup"
        description="Configure an API key for AI capabilities."
        layout="inline"
      />
      <CardContent className="space-y-6">
        {/* Step 1: Select Provider */}
        <SetupStep
          num={1}
          active={currentStep === 1}
          completed={currentStep > 1}
          headline={
            <Label
              className={`leading-6 ${currentStep === 1 ? "" : "text-muted-foreground"}`}
            >
              Select an AI provider
            </Label>
          }
        >
          <div className="space-y-2">
            {LLM_PROVIDERS.map((provider) => (
              <label
                key={provider.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
                  aiProvider === provider.id
                    ? "border-primary bg-primary/5"
                    : "border-border"
                )}
              >
                <input
                  type="radio"
                  name="ai-provider"
                  value={provider.id}
                  checked={aiProvider === provider.id}
                  onChange={() => {
                    setAIProvider(provider.id);
                    setAIApiKey("");
                    setHasOpenedKeyPage(false);
                  }}
                  disabled={completing}
                  className="mt-0.5"
                />
                <div className="text-left">
                  <span className="font-medium text-sm">{provider.name}</span>
                  <p className="text-xs text-muted-foreground">
                    {provider.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </SetupStep>

        {/* Step 2: Create API Key */}
        <SetupStep
          num={2}
          active={currentStep === 2 && !aiApiKey.trim()}
          completed={hasOpenedKeyPage || !!aiApiKey.trim()}
          headline="Create an API key"
        >
          <Button
            variant={
              hasOpenedKeyPage || aiApiKey.trim() ? "outline" : "default"
            }
            size="sm"
            disabled={!aiProvider || completing}
            onClick={() => {
              if (aiProvider && selectedProvider) {
                window.open(selectedProvider.helpUrl, "_blank");
                setHasOpenedKeyPage(true);
              }
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {selectedProvider?.createKeyText || "Create API Key"}
          </Button>
        </SetupStep>

        {/* Step 3: Enter API Key */}
        <SetupStep
          num={3}
          active={currentStep >= 2}
          completed={!!aiApiKey.trim()}
          headline={
            <Label
              htmlFor="ai-api-key"
              className={`font-normal leading-6 ${aiProvider ? "" : "text-muted-foreground"}`}
            >
              Paste your{" "}
              <span
                className={`font-semibold ${aiProvider ? "text-foreground" : ""}`}
              >
                API key
              </span>
            </Label>
          }
        >
          <Input
            id="ai-api-key"
            type="text"
            placeholder={selectedProvider?.placeholder || "API key"}
            value={aiApiKey}
            onChange={(e) => setAIApiKey(e.target.value)}
            disabled={!aiProvider || completing}
            data-1p-ignore
            autoComplete="off"
          />
        </SetupStep>

        <OnboardingStepFooter
          onBack={onBack}
          onSkip={onSkip}
          onContinue={handleComplete}
          continueDisabled={!canComplete}
          loading={completing}
        />
      </CardContent>
    </Card>
  );
}
