"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Agent } from "@blink.so/api";
import { Check, Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface WebhooksSectionProps {
  agent: Agent;
  organizationName: string;
  agentName: string;
}

export function WebhooksSection({
  agent,
  organizationName,
  agentName,
}: WebhooksSectionProps) {
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const router = useRouter();

  const requestUrl = agent.request_url || "";
  const hasRequestUrl = !!agent.request_url;

  const displayUrl = isVisible ? requestUrl : "••••••••••••••••••••••••••••";

  const handleCopy = async () => {
    if (hasRequestUrl) {
      await navigator.clipboard.writeText(requestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleViewLogs = () => {
    const filters = {
      type: "and" as const,
      filters: [
        {
          type: "eq" as const,
          key: "type",
          value: "blink.request.webhook",
        },
      ],
    };
    const queryParams = new URLSearchParams({
      filters: JSON.stringify(filters),
    });
    router.push(
      `/${organizationName}/${agentName}/logs?${queryParams.toString()}`
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg">Webhook Request URL</h2>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Send HTTP requests to this URL from external services like GitHub,
            Slack, or Stripe to trigger your agent.
          </p>
          <p>
            Handle incoming requests in your agent code using the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              agent.on(&quot;request&quot;, ...)
            </code>{" "}
            handler. This allows you to start chats, process webhooks, or
            respond to external events.
          </p>
        </div>
      </div>

      {hasRequestUrl ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                value={displayUrl}
                readOnly
                className="pr-10 font-mono text-sm"
              />
              <Button
                onClick={() => setIsVisible(!isVisible)}
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full hover:bg-transparent"
                title={isVisible ? "Hide URL" : "Show URL"}
              >
                {isVisible ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              onClick={handleCopy}
              variant="outline"
              size="icon"
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <Button onClick={handleViewLogs} variant="outline" size="sm">
            <ExternalLink className="h-4 w-4 mr-2" />
            View Webhook Logs
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Deploy your agent to generate a webhook URL.
          </p>
        </div>
      )}
    </div>
  );
}
