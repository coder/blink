import { Check } from "lucide-react";

interface StepNumberProps {
  num: number;
  active: boolean;
  completed: boolean;
}

export function StepNumber({ num, active, completed }: StepNumberProps) {
  return (
    <div
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
        completed
          ? "bg-green-500 text-white"
          : active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {completed ? <Check className="h-4 w-4" /> : num}
    </div>
  );
}
