"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingStep } from "./wizard-content";

const stepLabels: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  "llm-api-keys": "LLM",
  "github-setup": "GitHub",
  "slack-setup": "Slack",
  "web-search": "Web Search",
  deploying: "Deploy",
  success: "Success",
};

interface ProgressIndicatorProps {
  steps: OnboardingStep[];
  currentStep: OnboardingStep;
  onStepClick?: (step: OnboardingStep) => void;
  /** When true, only the welcome step is clickable */
  welcomeOnly?: boolean;
}

export function ProgressIndicator({
  steps,
  currentStep,
  onStepClick,
  welcomeOnly = false,
}: ProgressIndicatorProps) {
  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isDisabled = welcomeOnly && step !== "welcome";

        return (
          <div key={step} className="flex items-center">
            <button
              type="button"
              disabled={isDisabled}
              className={cn(
                "flex flex-col items-center",
                onStepClick && !isDisabled && "cursor-pointer"
              )}
              onClick={() => !isDisabled && onStepClick?.(step)}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  isComplete && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground",
                  !isComplete && !isCurrent && "bg-muted text-muted-foreground",
                  onStepClick &&
                    !isDisabled &&
                    "hover:ring-2 hover:ring-primary/50"
                )}
              >
                {isComplete ? <Check className="h-4 w-4" /> : index + 1}
              </div>
              <span
                className={cn(
                  "mt-1 text-xs",
                  isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                )}
              >
                {stepLabels[step] || step}
              </span>
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-8 mx-2 mb-5",
                  index < currentIndex ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
