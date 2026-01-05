"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface OnboardingStepFooterProps {
  onBack?: () => void;
  onSkip?: () => void;
  /** Primary action. When not provided, only shows back/skip buttons */
  onContinue?: () => void;
  continueDisabled?: boolean;
  disabled?: boolean;
  continueText?: string;
  loadingText?: string;
  loading?: boolean;
  /** Additional class names for the container */
  className?: string;
}

export function OnboardingStepFooter({
  onBack,
  onSkip,
  onContinue,
  continueDisabled,
  disabled,
  continueText = "Continue",
  loadingText = "Saving...",
  loading,
  className,
}: OnboardingStepFooterProps) {
  return (
    <div
      className={cn(
        "flex pt-4 border-t",
        onBack ? "justify-between" : "justify-end",
        className
      )}
    >
      {onBack && (
        <Button variant="ghost" onClick={onBack} disabled={disabled || loading}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      )}
      <div className="flex gap-2">
        {onSkip && (
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={disabled || loading}
          >
            Skip
          </Button>
        )}
        {onContinue && (
          <Button
            onClick={onContinue}
            disabled={continueDisabled || disabled || loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? loadingText : continueText}
          </Button>
        )}
      </div>
    </div>
  );
}
