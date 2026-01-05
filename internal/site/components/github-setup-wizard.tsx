"use client";

import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { OnboardingStepFooter } from "@/components/onboarding-step-footer";
import { OnboardingStepHeader } from "@/components/onboarding-step-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupStep } from "@/components/ui/setup-step";
import { useAPIClient } from "@/lib/api-client";
import { ADJECTIVES, NOUNS } from "./app-name-words";
import { GitHubIcon } from "./icons/github";

function generateRandomAppName(agentName: string): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const randomNumber = Math.floor(Math.random() * 900) + 100; // 100-999
  return `${agentName}-${adjective}-${noun}-${randomNumber}`;
}

export interface GitHubSetupWizardInitialState {
  organization?: string;
  sessionId?: string;
  hasOpenedGitHub?: boolean;
  manifestData?: {
    manifest: string;
    github_url: string;
  };
  creationStatus?:
    | "pending"
    | "app_created"
    | "completed"
    | "failed"
    | "expired";
  appData?: {
    id: number;
    name: string;
    html_url: string;
    slug: string;
  };
  credentials?: GitHubAppCredentials;
  completing?: boolean;
  error?: string;
}

export interface GitHubAppCredentials {
  appId: number;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKey: string; // base64-encoded PEM
}

interface GitHubSetupWizardProps {
  agentId: string;
  agentName: string;
  onComplete: (result: {
    appName: string;
    appUrl: string;
    installUrl: string;
    credentials: GitHubAppCredentials;
  }) => void;
  onBack?: () => void;
  onSkip?: () => void;
  initialState?: GitHubSetupWizardInitialState;
}

export function GitHubSetupWizard({
  agentId,
  agentName,
  onComplete,
  onBack,
  onSkip,
  initialState,
}: GitHubSetupWizardProps) {
  const client = useAPIClient();

  // Generate app name (user can change on GitHub)
  const [appName] = useState(() => generateRandomAppName(agentName));

  // Form state
  const [githubOrganization, setGithubOrganization] = useState(
    initialState?.organization ?? ""
  );

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(
    initialState?.sessionId ?? null
  );
  const [manifestData, setManifestData] = useState<{
    manifest: string;
    github_url: string;
  } | null>(initialState?.manifestData ?? null);
  const [hasOpenedGitHub, setHasOpenedGitHub] = useState(
    initialState?.hasOpenedGitHub ?? false
  );

  // Creation status
  const [creationStatus, setCreationStatus] = useState<
    "pending" | "app_created" | "completed" | "failed" | "expired" | null
  >(initialState?.creationStatus ?? null);
  const [appData, setAppData] = useState<{
    id: number;
    name: string;
    html_url: string;
    slug: string;
  } | null>(initialState?.appData ?? null);
  const [credentials, setCredentials] = useState<GitHubAppCredentials | null>(
    initialState?.credentials ?? null
  );
  const [error, setError] = useState<string | null>(
    initialState?.error ?? null
  );

  // Completion state
  const [completing, setCompleting] = useState(
    initialState?.completing ?? false
  );
  const [starting, setStarting] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Determine current step
  // Step 1 is completed only when user has clicked "Create GitHub App" (step 2 button)
  const currentStep = useMemo(() => {
    if (!hasOpenedGitHub) return 2;
    if (creationStatus === "pending") return 3;
    if (creationStatus === "app_created") return 3; // Still waiting for installation
    if (creationStatus === "completed") return 4;
    return 2;
  }, [hasOpenedGitHub, creationStatus]);

  // Submit manifest to GitHub via form POST (opens in new tab)
  const submitManifestForm = useCallback(
    (githubUrl: string, manifest: string) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = githubUrl;
      form.target = "_blank";

      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = manifest;

      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    },
    []
  );

  // Track the organization used for the current session
  const [sessionOrganization, setSessionOrganization] = useState<string | null>(
    null
  );

  // Start creation flow and open GitHub in a new tab via form submission
  const startCreation = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);

    const orgToUse = githubOrganization.trim() || undefined;

    try {
      const result = await client.agents.setupGitHub.startCreation(agentId, {
        name: appName,
        organization: orgToUse,
      });
      setSessionId(result.session_id);
      setSessionOrganization(githubOrganization);
      setManifestData({
        manifest: result.manifest,
        github_url: result.github_url,
      });
      setCreationStatus("pending");

      // Submit form to GitHub - this opens in a new tab and POSTs the manifest
      submitManifestForm(result.github_url, result.manifest);
      setHasOpenedGitHub(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start creation"
      );
      setError(
        error instanceof Error ? error.message : "Failed to start creation"
      );
    } finally {
      setStarting(false);
    }
  }, [
    client,
    agentId,
    appName,
    githubOrganization,
    starting,
    submitManifestForm,
  ]);

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
      // Store credentials when status is completed
      if (status.credentials) {
        setCredentials({
          appId: status.credentials.app_id,
          clientId: status.credentials.client_id,
          clientSecret: status.credentials.client_secret,
          webhookSecret: status.credentials.webhook_secret,
          privateKey: status.credentials.private_key,
        });
      }
      if (status.error) {
        setError(status.error);
      }
      return status;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: useful for debugging polling failures
      console.error("Failed to poll creation status:", error);
      return null;
    }
  }, [client, agentId, sessionId]);

  // Start polling when in pending or app_created state
  useEffect(() => {
    if (
      (creationStatus === "pending" || creationStatus === "app_created") &&
      sessionId
    ) {
      const poll = async () => {
        const status = await pollCreationStatus();
        if (
          status?.status === "completed" ||
          status?.status === "failed" ||
          status?.status === "expired"
        ) {
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
    if (!sessionId || !credentials || !appData) return;
    setCompleting(true);

    try {
      // Call completeCreation to clear the server-side setup state
      const result = await client.agents.setupGitHub.completeCreation(agentId, {
        session_id: sessionId,
      });

      if (result.success) {
        // Pass credentials to onComplete so the caller can save them as env vars
        onComplete({
          appName: appData.name,
          appUrl: appData.html_url,
          installUrl: `${appData.html_url}/installations/new`,
          credentials,
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
  }, [client, agentId, sessionId, credentials, appData, onComplete]);

  // Reset to try again
  const handleRetry = () => {
    setSessionId(null);
    setSessionOrganization(null);
    setManifestData(null);
    setHasOpenedGitHub(false);
    setCreationStatus(null);
    setAppData(null);
    setCredentials(null);
    setError(null);
  };

  return (
    <Card className="w-full">
      <OnboardingStepHeader
        icon={GitHubIcon}
        iconBgClassName="bg-[#24292f]"
        iconClassName="text-white"
        title="GitHub App Setup"
        description="Create a GitHub App to connect your agent to GitHub repositories."
        layout="inline"
      />
      <CardContent className="space-y-6">
        {/* Step 1: Organization (optional) - completed when Create button is clicked */}
        <SetupStep
          num={1}
          active={!hasOpenedGitHub}
          completed={hasOpenedGitHub}
          headline={
            <Label
              htmlFor="organization"
              className={`leading-6 ${!hasOpenedGitHub ? "" : "text-muted-foreground"}`}
            >
              GitHub Organization (optional)
            </Label>
          }
        >
          <Input
            id="organization"
            placeholder="Leave blank for personal app"
            value={githubOrganization}
            onChange={(e) => setGithubOrganization(e.target.value)}
            disabled={creationStatus === "completed"}
          />
          <p className="text-xs text-muted-foreground">
            Enter a GitHub organization name to create the app under, or leave
            blank for a personal app.
          </p>
        </SetupStep>

        {/* Step 2: Create GitHub App */}
        <SetupStep
          num={2}
          active={currentStep === 2}
          completed={currentStep > 2}
          headline="Create and install the GitHub App"
        >
          <p className="text-xs text-muted-foreground">
            Click the button to open GitHub. You&apos;ll create the app and then
            install it on your repositories.
          </p>
          <Button
            variant={hasOpenedGitHub ? "outline" : "default"}
            size="sm"
            disabled={starting}
            onClick={async () => {
              // If org has changed since last session, start a new creation
              const orgChanged = sessionOrganization !== githubOrganization;
              if (manifestData && !orgChanged) {
                // Re-open GitHub with existing manifest
                submitManifestForm(
                  manifestData.github_url,
                  manifestData.manifest
                );
              } else {
                // Start new creation flow (or restart with new org)
                await startCreation();
              }
            }}
          >
            {starting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            {hasOpenedGitHub
              ? "Open GitHub again"
              : "Create & install on GitHub"}
          </Button>
        </SetupStep>

        {/* Step 3: Waiting for app creation */}
        {creationStatus === "pending" && (
          <SetupStep
            num={3}
            active={true}
            completed={false}
            headline="Creating GitHub App..."
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Complete the app creation on GitHub</span>
            </div>
          </SetupStep>
        )}

        {/* Step 3: Waiting for installation */}
        {creationStatus === "app_created" && (
          <SetupStep
            num={3}
            active={true}
            completed={false}
            headline="Installing GitHub App..."
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                App created! Now{" "}
                <a
                  href={`${appData?.html_url}/installations/new`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-500 hover:underline inline-flex items-center gap-0.5"
                >
                  install it to your repositories
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                and return here
              </span>
            </div>
          </SetupStep>
        )}

        {/* Step 3/4: Error state */}
        {(creationStatus === "failed" || creationStatus === "expired") && (
          <SetupStep
            num={3}
            active={true}
            completed={false}
            indicator={
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                <AlertCircle className="h-4 w-4" />
              </div>
            }
            headline={
              <p className="text-sm font-medium leading-6 text-red-500">
                {creationStatus === "expired"
                  ? "Session expired"
                  : "Creation failed"}
              </p>
            }
          >
            {error && <p className="text-xs text-muted-foreground">{error}</p>}
            <Button variant="outline" size="sm" onClick={handleRetry}>
              Try again
            </Button>
          </SetupStep>
        )}

        {/* Step 3: Success */}
        {creationStatus === "completed" && appData && (
          <SetupStep
            num={3}
            active={false}
            completed={true}
            headline={
              <p className="text-sm font-medium leading-6 text-green-600">
                GitHub App created and installed!
              </p>
            }
          >
            <p className="text-xs text-muted-foreground">
              Click Continue below to proceed.
            </p>
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
          </SetupStep>
        )}

        <OnboardingStepFooter
          onBack={onBack}
          onSkip={onSkip}
          onContinue={completeSetup}
          continueDisabled={creationStatus !== "completed" || !credentials}
          loading={completing}
        />
      </CardContent>
    </Card>
  );
}
