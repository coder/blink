"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ArrowLeft, Key } from "lucide-react";
import { useState } from "react";

type AIProvider = "anthropic" | "openai" | "vercel";

interface ApiKeysStepProps {
  initialValues?: {
    aiProvider?: AIProvider;
    aiApiKey?: string;
    exaApiKey?: string;
  };
  onContinue: (values: {
    aiProvider?: AIProvider;
    aiApiKey?: string;
    exaApiKey?: string;
  }) => void;
  onSkip: () => void;
  onBack: () => void;
}

const providers: {
  id: AIProvider;
  name: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  helpText: string;
}[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpText: "Get an Anthropic API key",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT models",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpText: "Get an OpenAI API key",
  },
  {
    id: "vercel",
    name: "Vercel AI Gateway",
    description: "Unified gateway for multiple providers",
    placeholder: "your-gateway-url",
    helpUrl: "https://vercel.com/docs/ai-gateway",
    helpText: "Learn about Vercel AI Gateway",
  },
];

export function ApiKeysStep({
  initialValues,
  onContinue,
  onSkip,
  onBack,
}: ApiKeysStepProps) {
  const [aiProvider, setAIProvider] = useState<AIProvider | undefined>(
    initialValues?.aiProvider
  );
  const [aiApiKey, setAIApiKey] = useState(initialValues?.aiApiKey || "");
  const [exaApiKey, setExaApiKey] = useState(initialValues?.exaApiKey || "");

  const selectedProvider = providers.find((p) => p.id === aiProvider);

  const handleContinue = () => {
    onContinue({
      aiProvider: aiProvider,
      aiApiKey: aiApiKey || undefined,
      exaApiKey: exaApiKey || undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <CardTitle>API Keys</CardTitle>
        </div>
        <CardDescription>
          Configure API keys for AI capabilities. You can add or change these
          later in the agent settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label>AI Provider</Label>
          <div className="grid grid-cols-3 gap-2">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  setAIProvider(provider.id);
                  setAIApiKey("");
                }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg border p-3 text-center transition-colors hover:bg-muted/50",
                  aiProvider === provider.id
                    ? "border-primary bg-primary/5"
                    : "border-border"
                )}
              >
                <span className="font-medium text-sm">{provider.name}</span>
                <span className="text-xs text-muted-foreground">
                  {provider.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {selectedProvider && (
          <div className="space-y-2">
            <Label htmlFor="ai-api-key">
              {selectedProvider.name} API Key{" "}
              <span className="text-muted-foreground">(required)</span>
            </Label>
            <Input
              id="ai-api-key"
              type="password"
              placeholder={selectedProvider.placeholder}
              value={aiApiKey}
              onChange={(e) => setAIApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <a
                href={selectedProvider.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {selectedProvider.helpText}
              </a>
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="exa-api-key">
            Exa API Key{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="exa-api-key"
            type="password"
            placeholder="your-exa-api-key"
            value={exaApiKey}
            onChange={(e) => setExaApiKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Enables web search capabilities.{" "}
            <a
              href="https://exa.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Get an API key
            </a>
          </p>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip}>
              Skip
            </Button>
            <Button onClick={handleContinue}>Continue</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
