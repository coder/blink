"use client";

import { WebSearchSetup } from "@/components/web-search-setup";

interface WebSearchStepProps {
  initialValue?: string;
  onContinue: (exaApiKey?: string) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function WebSearchStep({
  initialValue,
  onContinue,
  onSkip,
  onBack,
}: WebSearchStepProps) {
  return (
    <WebSearchSetup
      initialValue={initialValue}
      onComplete={(result) => onContinue(result.exaApiKey)}
      onBack={onBack}
      onSkip={onSkip}
    />
  );
}
