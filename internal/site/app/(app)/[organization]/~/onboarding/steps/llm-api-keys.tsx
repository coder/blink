"use client";

import {
  type AIProvider,
  LlmApiKeysSetup,
} from "@/components/llm-api-keys-setup";

interface LlmApiKeysStepProps {
  initialValues?: {
    provider?: AIProvider;
    apiKey?: string;
  };
  onContinue: (values: { provider?: AIProvider; apiKey?: string }) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function LlmApiKeysStep({
  initialValues,
  onContinue,
  onSkip,
  onBack,
}: LlmApiKeysStepProps) {
  return (
    <LlmApiKeysSetup
      initialValues={initialValues}
      onComplete={(result) =>
        onContinue({ provider: result.provider, apiKey: result.apiKey })
      }
      onBack={onBack}
      onSkip={onSkip}
    />
  );
}
