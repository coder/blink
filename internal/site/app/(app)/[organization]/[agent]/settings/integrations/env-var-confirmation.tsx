"use client";

import { ArrowLeft, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface EnvVarConfig {
  defaultKey: string; // Original suggested name (e.g., "SLACK_BOT_TOKEN")
  currentKey: string; // User-editable name
  value: string; // Actual value (masked in UI for secrets)
  secret: boolean;
}

export interface EnvVarConfirmationProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBgColor: string;
  envVars: EnvVarConfig[];
  onEnvVarsChange: (envVars: EnvVarConfig[]) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onBack?: () => void;
  saving: boolean;
}

export function EnvVarConfirmation({
  title,
  description,
  icon,
  iconBgColor,
  envVars,
  onEnvVarsChange,
  onSave,
  onCancel,
  onBack,
  saving,
}: EnvVarConfirmationProps) {
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(
    new Set()
  );

  const handleKeyChange = (index: number, newKey: string) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], currentKey: newKey };
    onEnvVarsChange(updated);
  };

  const toggleReveal = (index: number) => {
    setRevealedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const maskValue = (value: string) => {
    if (value.length <= 8) {
      return "••••••••";
    }
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  };

  const hasEmptyKeys = envVars.some((env) => !env.currentKey.trim());
  const hasDuplicateKeys =
    new Set(envVars.map((env) => env.currentKey)).size !== envVars.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              disabled={saving}
              className="h-8 w-8"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBgColor}`}
          >
            {icon}
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-3">
          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Review the environment variables that will be saved. You can edit
            the variable names if needed.
          </p>
        </div>

        <div className="space-y-3">
          {envVars.map((envVar, index) => (
            <div key={envVar.defaultKey} className="flex gap-2">
              <Input
                id={`env-key-${index}`}
                value={envVar.currentKey}
                onChange={(e) => handleKeyChange(index, e.target.value)}
                placeholder={envVar.defaultKey}
                disabled={saving}
                className="shrink-0 font-mono text-sm"
                style={{
                  width: `calc(${Math.max(envVar.currentKey.length, 12)}ch + 1.75rem)`,
                }}
              />
              <div className="flex flex-1 items-center gap-1 rounded-md border bg-muted px-3 text-sm font-mono min-w-[200px]">
                <span className="flex-1 truncate">
                  {envVar.secret
                    ? revealedIndices.has(index)
                      ? envVar.value
                      : maskValue(envVar.value)
                    : envVar.value}
                </span>
                {envVar.secret && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => toggleReveal(index)}
                    disabled={saving}
                  >
                    {revealedIndices.has(index) ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {hasEmptyKeys && (
          <p className="text-sm text-destructive">
            All variable names must be filled in.
          </p>
        )}
        {hasDuplicateKeys && (
          <p className="text-sm text-destructive">
            Variable names must be unique.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || hasEmptyKeys || hasDuplicateKeys}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Environment Variables
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
