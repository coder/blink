"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const stepLabels: Record<string, string> = {
  welcome: "Welcome",
  "github-setup": "GitHub",
  "slack-setup": "Slack",
  "api-keys": "API Keys",
  deploying: "Deploy",
};

interface ProgressIndicatorProps {
  steps: string[];
  currentStep: string;
}

export function ProgressIndicator({
  steps,
  currentStep,
}: ProgressIndicatorProps) {
  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  isComplete && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground",
                  !isComplete && !isCurrent && "bg-muted text-muted-foreground"
                )}
              >
                {isComplete ? <Check className="h-4 w-4" /> : index + 1}
              </div>
              <span
                className={cn(
                  "mt-1 text-xs",
                  isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {stepLabels[step] || step}
              </span>
            </div>
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
