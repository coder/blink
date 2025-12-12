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
import type Client from "@blink.so/api";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export interface GitHubSetupWizardInitialState {
  webhookUrl?: string | null;
  loadingWebhookUrl?: boolean;
  appName?: string;
  organization?: string;
  sessionId?: string;
  hasOpenedGitHub?: boolean;
  manifestUrl?: string;
  creationStatus?: "pending" | "completed" | "failed" | "expired";
  appData?: {
    id: number;
    name: string;
    html_url: string;
    slug: string;
  };
  completing?: boolean;
  error?: string;
}

interface GitHubSetupWizardProps {
  client: Client;
  agentId: string;
  agentName: string;
  onComplete: (result: {
    appName: string;
    appUrl: string;
    installUrl: string;
  }) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  initialState?: GitHubSetupWizardInitialState;
}

export function GitHubSetupWizard({
  client,
  agentId,
  agentName,
  onComplete,
  onCancel,
  onBack,
  onSkip,
  initialState,
}: GitHubSetupWizardProps) {
  // Webhook URL state
  const [webhookUrl, setWebhookUrl] = useState<string | null>(
    initialState?.webhookUrl ?? null
  );
  const [loadingWebhookUrl, setLoadingWebhookUrl] = useState(
    initialState?.loadingWebhookUrl ?? initialState?.webhookUrl === undefined
  );

  // Form state
  const [appName, setAppName] = useState(initialState?.appName ?? agentName);
  const [organization, setOrganization] = useState(
    initialState?.organization ?? ""
  );

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(
    initialState?.sessionId ?? null
  );
  const [manifestUrl, setManifestUrl] = useState<string | null>(
    initialState?.manifestUrl ?? null
  );
  const [hasOpenedGitHub, setHasOpenedGitHub] = useState(
    initialState?.hasOpenedGitHub ?? false
  );

  // Creation status
  const [creationStatus, setCreationStatus] = useState<
    "pending" | "completed" | "failed" | "expired" | null
  >(initialState?.creationStatus ?? null);
  const [appData, setAppData] = useState<{
    id: number;
    name: string;
    html_url: string;
    slug: string;
  } | null>(initialState?.appData ?? null);
  const [error, setError] = useState<string | null>(
    initialState?.error ?? null
  );

  // Completion state
  const [completing, setCompleting] = useState(
    initialState?.completing ?? false
  );
  const [starting, setStarting] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch webhook URL on mount
  useEffect(() => {
    if (initialState?.webhookUrl !== undefined) return;

    async function fetchWebhookUrl() {
      try {
        const result = await client.agents.setupGitHub.getWebhookUrl(agentId);
        setWebhookUrl(result.webhook_url);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load webhook URL"
        );
      } finally {
        setLoadingWebhookUrl(false);
      }
    }
    fetchWebhookUrl();
  }, [client, agentId, initialState?.webhookUrl]);

  // Determine current step
  const currentStep = useMemo(() => {
    if (!appName.trim()) return 1;
    if (!hasOpenedGitHub) return 2;
    if (creationStatus === "pending") return 3;
    if (creationStatus === "completed") return 4;
    return 2;
  }, [appName, hasOpenedGitHub, creationStatus]);

  // Start creation flow
  const startCreation = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);

    try {
      const result = await client.agents.setupGitHub.startCreation(agentId, {
        name: appName,
        organization: organization.trim() || undefined,
      });
      setSessionId(result.session_id);
      setManifestUrl(result.manifest_url);
      setCreationStatus("pending");
      return result.manifest_url;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start creation"
      );
      setError(
        error instanceof Error ? error.message : "Failed to start creation"
      );
      return null;
    } finally {
      setStarting(false);
    }
  }, [client, agentId, appName, organization, starting]);

  // Poll for creation status
  const pollCreationStatus = useCallback(async () => {
    if (!sessionId) return null;

    try {
      const status = await client.agents.setupGitHub.getCreationStatus(
        agentId,
        sessionId
      );
      setCreationStatus(status.status);
      if (status.app_data) {
        setAppData(status.app_data);
      }
      if (status.error) {
        setError(status.error);
      }
      return status;
    } catch (error) {
      console.error("Failed to poll creation status:", error);
      return null;
    }
  }, [client, agentId, sessionId]);

  // Start polling when in pending state
  useEffect(() => {
    if (creationStatus === "pending" && sessionId) {
      const poll = async () => {
        const status = await pollCreationStatus();
        if (status?.status === "completed" || status?.status === "failed" || status?.status === "expired") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
          }
        }
      };
      poll();
      pollingRef.current = setInterval(poll, 2000);

      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
      };
    }
  }, [creationStatus, sessionId, pollCreationStatus]);

  // Complete setup
  const completeSetup = useCallback(async () => {
    if (!sessionId) return;
    setCompleting(true);

    try {
      const result = await client.agents.setupGitHub.completeCreation(
        agentId,
        { session_id: sessionId }
      );

      if (result.success && result.app_name && result.app_url && result.install_url) {
        toast.success("GitHub App setup complete!");
        onComplete({
          appName: result.app_name,
          appUrl: result.app_url,
          installUrl: result.install_url,
        });
      } else {
        toast.error("Failed to complete setup");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to complete setup"
      );
    } finally {
      setCompleting(false);
    }
  }, [client, agentId, sessionId, onComplete]);

  // Cancel creation
  const handleCancel = async () => {
    try {
      await client.agents.setupGitHub.cancelCreation(agentId);
    } catch {
      // Ignore errors when canceling
    }
    onCancel();
  };

  // Reset to try again
  const handleRetry = () => {
    setSessionId(null);
    setManifestUrl(null);
    setHasOpenedGitHub(false);
    setCreationStatus(null);
    setAppData(null);
    setError(null);
  };

  // Step indicator component
  const StepNumber = ({
    num,
    active,
    completed,
  }: {
    num: number;
    active: boolean;
    completed: boolean;
  }) => (
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

  // GitHub icon
  const GitHubIcon = ({ className }: { className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#24292f]">
            <GitHubIcon className="h-4 w-4 text-white" />
          </div>
          <CardTitle>GitHub App Setup</CardTitle>
        </div>
        <CardDescription>
          Create a GitHub App to connect your agent to GitHub repositories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1: App Name & Organization */}
        <div className="flex items-start gap-3">
          <StepNumber
            num={1}
            active={currentStep === 1}
            completed={currentStep > 1}
          />
          <div className="flex-1 space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="app-name"
                className={currentStep === 1 ? "" : "text-muted-foreground"}
              >
                What should your GitHub App be called?
              </Label>
              <Input
                id="app-name"
                placeholder="My Agent"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                disabled={hasOpenedGitHub}
                maxLength={34}
              />
              <p className="text-xs text-muted-foreground">
                This is the name that will appear on GitHub. You can change it later.
              </p>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="organization"
                className="text-muted-foreground"
              >
                Organization (optional)
              </Label>
              <Input
                id="organization"
                placeholder="Leave blank for personal app"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                disabled={hasOpenedGitHub}
              />
              <p className="text-xs text-muted-foreground">
                Enter a GitHub organization name to create the app under, or leave blank for a personal app.
              </p>
            </div>
          </div>
        </div>

        {/* Step 2: Create GitHub App */}
        <div className="flex items-start gap-3">
          <StepNumber
            num={2}
            active={currentStep === 2}
            completed={currentStep > 2}
          />
          <div className="flex-1 space-y-2">
            <p
              className={`text-sm font-medium ${
                currentStep >= 2 ? "" : "text-muted-foreground"
              }`}
            >
              Create the GitHub App
            </p>
            <p className="text-xs text-muted-foreground">
              Click the button to open GitHub and create your app. After you finish on GitHub, return here.
            </p>
            <Button
              variant={hasOpenedGitHub ? "outline" : "default"}
              size="sm"
              disabled={currentStep < 2 || loadingWebhookUrl || !appName.trim() || starting}
              onClick={async () => {
                const url = manifestUrl || await startCreation();
                if (url) {
                  window.open(url, "_blank");
                  setHasOpenedGitHub(true);
                }
              }}
            >
              {loadingWebhookUrl || starting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              {hasOpenedGitHub ? "Open GitHub again" : "Create app on GitHub"}
            </Button>
          </div>
        </div>

        {/* Step 3: Waiting */}
        {creationStatus === "pending" && (
          <div className="flex items-start gap-3">
            <StepNumber num={3} active={true} completed={false} />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">Waiting for GitHub...</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Complete the app creation on GitHub and return here</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 3/4: Error state */}
        {(creationStatus === "failed" || creationStatus === "expired") && (
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-red-500">
                {creationStatus === "expired" ? "Session expired" : "Creation failed"}
              </p>
              {error && (
                <p className="text-xs text-muted-foreground">{error}</p>
              )}
              <Button variant="outline" size="sm" onClick={handleRetry}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Success */}
        {creationStatus === "completed" && appData && (
          <div className="flex items-start gap-3">
            <StepNumber num={3} active={false} completed={true} />
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-medium text-green-600">
                  GitHub App &quot;{appData.name}&quot; created!
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click the button below to save the credentials and complete setup.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={completeSetup}
                  disabled={completing}
                >
                  {completing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Save credentials
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={appData.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View app
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t pt-4">
          <div>
            {onBack && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onSkip && (
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Skip for now
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
