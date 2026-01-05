import type { ReactNode } from "react";
import { StepNumber } from "./step-number";

interface SetupStepProps {
  num: number;
  active: boolean;
  completed: boolean;
  headline: ReactNode;
  children: ReactNode;
  /** Optional custom indicator to replace the StepNumber (e.g., for error states) */
  indicator?: ReactNode;
}

export function SetupStep({
  num,
  active,
  completed,
  headline,
  children,
  indicator,
}: SetupStepProps) {
  return (
    <div className="flex items-start gap-3">
      {indicator ?? (
        <StepNumber num={num} active={active} completed={completed} />
      )}
      <div className="flex-1 space-y-2">
        {typeof headline === "string" ? (
          <p
            className={`text-sm font-medium leading-6 ${
              active ? "" : "text-muted-foreground"
            }`}
          >
            {headline}
          </p>
        ) : (
          headline
        )}
        {children}
      </div>
    </div>
  );
}
