"use client";

import type { ComponentType, ReactNode } from "react";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OnboardingStepHeaderProps {
  /** Icon component (LucideIcon or custom component like SlackIcon) */
  icon?: ComponentType<{ className?: string }>;
  /** Background color class for the icon circle (e.g., "bg-primary/10", "bg-[#24292f]") */
  iconBgClassName?: string;
  /** Icon color class (e.g., "text-primary", "text-white") */
  iconClassName?: string;
  /** Title text */
  title: string;
  /** Description text or ReactNode */
  description: ReactNode;
  /** Size variant - "lg" uses larger icon container (only applies to centered layout) */
  size?: "default" | "lg";
  /** Layout variant - "centered" for vertical centered, "inline" for horizontal with CardHeader */
  layout?: "centered" | "inline";
  /** Additional class names for the container */
  className?: string;
}

export function OnboardingStepHeader({
  icon: Icon,
  iconBgClassName = "bg-primary/10",
  iconClassName = "text-primary",
  title,
  description,
  size = "default",
  layout = "centered",
  className,
}: OnboardingStepHeaderProps) {
  if (layout === "inline") {
    return (
      <CardHeader className={className}>
        <div className="flex items-center gap-3">
          {Icon && (
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full",
                iconBgClassName
              )}
            >
              <Icon className={cn("h-4 w-4", iconClassName)} />
            </div>
          )}
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    );
  }

  const isLarge = size === "lg";

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      {Icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full",
            isLarge ? "mb-4 h-16 w-16" : "mb-6 h-14 w-14",
            iconBgClassName
          )}
        >
          <Icon
            className={cn(isLarge ? "h-8 w-8" : "h-7 w-7", iconClassName)}
          />
        </div>
      )}
      <h2 className={cn("font-semibold", isLarge ? "text-2xl" : "text-xl")}>
        {title}
      </h2>
      <p
        className={cn(
          "text-muted-foreground",
          isLarge ? "mt-1 text-base" : "mt-2"
        )}
      >
        {description}
      </p>
    </div>
  );
}
