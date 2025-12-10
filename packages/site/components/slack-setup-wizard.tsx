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
import {
  createAgentSlackManifest,
  createSlackAppUrl,
} from "@/lib/slack-manifest";
import type Client from "@blink.so/api";
import { SlackIcon } from "@/components/slack-icon";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export interface SlackSetupWizardInitialState {
  webhookUrl?: string | null;
  loadingWebhookUrl?: boolean;
  appName?: string;
  hasOpenedSlack?: boolean;
  appId?: string;
  signingSecret?: string;
  botToken?: string;
  validatingToken?: boolean;
  tokenValidated?: boolean;
  botTokenError?: boolean;
  signingSecretError?: boolean;
  verificationStarted?: boolean;
  dmReceived?: boolean;
  completing?: boolean;
}

interface SlackSetupWizardProps {
  client: Client;
  agentId: string;
  agentName: string;
  onComplete: (credentials: {
    botToken: string;
    signingSecret: string;
  }) => void;
  onCancel: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  /** Initial state for stories/testing - allows rendering in specific states */
  initialState?: SlackSetupWizardInitialState;
}

export function SlackSetupWizard({
  client,
  agentId,
  agentName,
  onComplete,
  onCancel,
  onBack,
  onSkip,
  initialState,
}: SlackSetupWizardProps) {
  // Webhook URL state (fetched from backend unless provided in initialState)
  const [webhookUrl, setWebhookUrl] = useState<string | null>(
    initialState?.webhookUrl ?? null
  );
  const [loadingWebhookUrl, setLoadingWebhookUrl] = useState(
    initialState?.loadingWebhookUrl ?? initialState?.webhookUrl === undefined
  );

  // Form state
  const [appName, setAppName] = useState(initialState?.appName ?? agentName);
  const [hasOpenedSlack, setHasOpenedSlack] = useState(
    initialState?.hasOpenedSlack ?? false
  );
  const [appId, setAppId] = useState(initialState?.appId ?? "");
  const [signingSecret, setSigningSecret] = useState(
    initialState?.signingSecret ?? ""
  );
  const [botToken, setBotToken] = useState(initialState?.botToken ?? "");

  // Validation state
  const [validatingToken, setValidatingToken] = useState(
    initialState?.validatingToken ?? false
  );
  const [tokenValidated, setTokenValidated] = useState(
    initialState?.tokenValidated ?? false
  );
  const [botTokenError, setBotTokenError] = useState(
    initialState?.botTokenError ?? false
  );
  const [signingSecretError, setSigningSecretError] = useState(
    initialState?.signingSecretError ?? false
  );

  // Verification state
  const [startingVerification, setStartingVerification] = useState(false);
  const [verificationStarted, setVerificationStarted] = useState(
    initialState?.verificationStarted ?? false
  );
  const [verificationStatus, setVerificationStatus] = useState<{
    active: boolean;
    lastEventAt?: string;
    dmReceived: boolean;
    signatureFailed: boolean;
  }>({
    active: initialState?.verificationStarted ?? false,
    dmReceived: initialState?.dmReceived ?? false,
    signatureFailed: false,
  });
  const [completing, setCompleting] = useState(
    initialState?.completing ?? false
  );
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch webhook URL on mount (skip if provided in initialState)
  useEffect(() => {
    if (initialState?.webhookUrl !== undefined) return;

    async function fetchWebhookUrl() {
      try {
        const result = await client.agents.setupSlack.getWebhookUrl(agentId);
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

  // Determine which step is active (1-indexed for display)
  const currentStep = useMemo(() => {
    if (!appName.trim()) return 1;
    if (!hasOpenedSlack) return 2;
    if (!appId.trim()) return 3;
    if (!signingSecret.trim()) return 4;
    if (!tokenValidated) return 5;
    return 6;
  }, [appName, hasOpenedSlack, appId, signingSecret, tokenValidated]);

  // Generate manifest URL client-side
  const manifestUrl = useMemo(() => {
    if (!webhookUrl) return null;
    const manifest = createAgentSlackManifest(appName, webhookUrl);
    return createSlackAppUrl(manifest);
  }, [appName, webhookUrl]);

  // Generate install URL from app ID
  const installUrl = useMemo(() => {
    if (!appId.trim()) return "";
    return `https://api.slack.com/apps/${appId}/install-on-team`;
  }, [appId]);

  // Generate app home page URL (for signing secret)
  const appHomeUrl = useMemo(() => {
    if (!appId.trim()) return "";
    return `https://api.slack.com/apps/${appId}`;
  }, [appId]);

  // Validate bot token on blur
  const validateBotToken = useCallback(async () => {
    if (!botToken.trim()) return;

    setValidatingToken(true);
    setBotTokenError(false);
    try {
      const result = await client.onboarding.validateCredentials({
        type: "slack",
        credentials: { botToken },
      });

      if (result.valid) {
        setTokenValidated(true);
        setBotTokenError(false);
      } else {
        toast.error(result.error || "Invalid bot token");
        setTokenValidated(false);
        setBotTokenError(true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Validation failed");
      setTokenValidated(false);
      setBotTokenError(true);
    } finally {
      setValidatingToken(false);
    }
  }, [client, botToken]);

  // Start verification (called when step 6 becomes active)
  const startVerification = useCallback(async () => {
    if (verificationStarted || startingVerification) return;

    setStartingVerification(true);
    try {
      await client.agents.setupSlack.startVerification(agentId, {
        signing_secret: signingSecret,
        bot_token: botToken,
      });
      setVerificationStarted(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start verification"
      );
    } finally {
      setStartingVerification(false);
    }
  }, [
    client,
    agentId,
    signingSecret,
    botToken,
    verificationStarted,
    startingVerification,
  ]);

  // Poll for verification status
  const pollVerificationStatus = useCallback(async () => {
    try {
      const status =
        await client.agents.setupSlack.getVerificationStatus(agentId);
      setVerificationStatus({
        active: status.active,
        lastEventAt: status.last_event_at,
        dmReceived: status.dm_received,
        signatureFailed: status.signature_failed,
      });
      return status;
    } catch (error) {
      console.error("Failed to poll verification status:", error);
      return null;
    }
  }, [client, agentId]);

  // Start verification when step 6 is reached (not if there's a signing secret error)
  useEffect(() => {
    if (
      currentStep === 6 &&
      tokenValidated &&
      !verificationStarted &&
      !signingSecretError
    ) {
      startVerification();
    }
  }, [
    currentStep,
    tokenValidated,
    verificationStarted,
    signingSecretError,
    startVerification,
  ]);

  // Start polling when verification is active
  useEffect(() => {
    if (verificationStarted && !verificationStatus.dmReceived) {
      const poll = async () => {
        const status = await pollVerificationStatus();
        if (status?.dm_received) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
          }
        }
        // Detect signature failure
        if (status?.signature_failed) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
          }
          setSigningSecretError(true);
          setVerificationStarted(false);
          toast.error(
            "Invalid signing secret. Please check and re-enter your signing secret."
          );
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
  }, [
    verificationStarted,
    verificationStatus.dmReceived,
    pollVerificationStatus,
  ]);

  // Complete setup
  const completeSetup = async () => {
    setCompleting(true);
    try {
      const result = await client.agents.setupSlack.completeVerification(
        agentId,
        {
          bot_token: botToken,
          signing_secret: signingSecret,
        }
      );

      if (result.success) {
        toast.success("Slack setup complete!");
        onComplete({ botToken, signingSecret });
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
  };

  // Cancel verification
  const handleCancel = async () => {
    try {
      await client.agents.setupSlack.cancelVerification(agentId);
    } catch {
      // Ignore errors when canceling
    }
    onCancel();
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

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4A154B]">
            <SlackIcon className="h-4 w-4 text-white" />
          </div>
          <CardTitle>Slack App Setup</CardTitle>
        </div>
        <CardDescription>
          Connect your agent to Slack in a few steps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1: App Name */}
        <div className="flex items-start gap-3">
          <StepNumber
            num={1}
            active={!hasOpenedSlack}
            completed={hasOpenedSlack}
          />
          <div className="flex-1 space-y-2">
            <Label
              htmlFor="app-name"
              className={currentStep === 1 ? "" : "text-muted-foreground"}
            >
              What would you like to call the agent in Slack?
            </Label>
            <Input
              id="app-name"
              placeholder="My Agent"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
            />
          </div>
        </div>

        {/* Step 2: Create Slack App */}
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
              Create the Slack app
            </p>
            <Button
              variant={hasOpenedSlack ? "outline" : "default"}
              size="sm"
              asChild
              disabled={currentStep < 2 || loadingWebhookUrl || !manifestUrl}
            >
              <a
                href={manifestUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (!manifestUrl || currentStep < 2 || loadingWebhookUrl) {
                    e.preventDefault();
                    return;
                  }
                  setHasOpenedSlack(true);
                }}
              >
                {loadingWebhookUrl ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" />
                )}
                {hasOpenedSlack ? "Re-create the app" : "Create the app"}
              </a>
            </Button>
          </div>
        </div>

        {/* Step 3: App ID */}
        <div className="flex items-start gap-3">
          <StepNumber
            num={3}
            active={currentStep === 3}
            completed={currentStep > 3}
          />
          <div className="flex-1 space-y-2">
            <Label
              htmlFor="app-id"
              className="font-normal text-muted-foreground"
            >
              Paste the{" "}
              <span
                className={`font-semibold ${currentStep >= 3 ? "text-foreground" : ""}`}
              >
                App ID
              </span>{" "}
              from the app home page
            </Label>
            <Input
              id="app-id"
              placeholder="A0123456789"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              disabled={currentStep < 3}
              data-1p-ignore
              autoComplete="off"
            />
          </div>
        </div>

        {/* Step 4: Signing Secret */}
        <div className="flex items-start gap-3">
          {signingSecretError ? (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-500 text-white">
              <AlertCircle className="h-4 w-4" />
            </div>
          ) : (
            <StepNumber
              num={4}
              active={currentStep === 4}
              completed={currentStep > 4}
            />
          )}
          <div className="flex-1 space-y-2">
            <Label
              htmlFor="signing-secret"
              className="font-normal text-muted-foreground"
            >
              Paste the{" "}
              <span
                className={`font-semibold ${currentStep >= 4 ? "text-foreground" : ""}`}
              >
                Signing Secret
              </span>{" "}
              from{" "}
              {appId && signingSecretError ? (
                <a
                  href={appHomeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-500 hover:underline inline-flex items-center gap-0.5"
                >
                  the same page
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                "the same page"
              )}
            </Label>
            <Input
              id="signing-secret"
              type="text"
              placeholder="Signing secret"
              value={signingSecret}
              onChange={(e) => {
                setSigningSecret(e.target.value);
                if (signingSecretError) {
                  // Clear error and reset verification when user fixes signing secret
                  setSigningSecretError(false);
                  setVerificationStarted(false);
                  setVerificationStatus({
                    active: false,
                    dmReceived: false,
                    signatureFailed: false,
                  });
                }
              }}
              disabled={currentStep < 4}
              data-1p-ignore
              autoComplete="off"
              className={
                signingSecretError
                  ? "border-yellow-500 focus-visible:ring-yellow-500"
                  : ""
              }
            />
            {signingSecretError && (
              <p className="text-xs text-yellow-600">
                Signing secret verification failed. Did you enter it correctly?
              </p>
            )}
          </div>
        </div>

        {/* Step 5: Bot Token */}
        <div className="flex items-start gap-3">
          {botTokenError ? (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-500 text-white">
              <AlertCircle className="h-4 w-4" />
            </div>
          ) : (
            <StepNumber
              num={5}
              active={currentStep === 5}
              completed={tokenValidated}
            />
          )}
          <div className="flex-1 space-y-2">
            <Label
              htmlFor="bot-token"
              className="font-normal text-muted-foreground"
            >
              {appId && currentStep >= 5 ? (
                <a
                  href={installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-500 hover:underline inline-flex items-center gap-0.5"
                >
                  Install the app
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span
                  className={`font-semibold inline-flex items-center gap-0.5 ${currentStep >= 5 ? "text-blue-500" : ""}`}
                >
                  Install the app
                  <ExternalLink className="h-3 w-3" />
                </span>
              )}{" "}
              and paste the{" "}
              <span
                className={`font-semibold ${currentStep >= 5 ? "text-foreground" : ""}`}
              >
                Bot Token
              </span>
            </Label>
            <div className="relative">
              <Input
                id="bot-token"
                type="text"
                placeholder="xoxb-..."
                value={botToken}
                onChange={(e) => {
                  setBotToken(e.target.value);
                  setTokenValidated(false);
                  setBotTokenError(false);
                }}
                onBlur={validateBotToken}
                disabled={currentStep < 5}
                data-1p-ignore
                autoComplete="off"
                className={`${tokenValidated ? "pr-10" : ""} ${botTokenError ? "border-yellow-500 focus-visible:ring-yellow-500" : ""}`}
              />
              {validatingToken && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {tokenValidated && !validatingToken && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Check className="h-4 w-4 text-green-500" />
                </div>
              )}
            </div>
            {botTokenError && (
              <p className="text-xs text-yellow-600">
                Bot token validation failed. Did you enter it correctly?
              </p>
            )}
          </div>
        </div>

        {/* Step 6: DM Verification */}
        <div className="flex items-start gap-3">
          <StepNumber
            num={6}
            active={currentStep === 6}
            completed={verificationStatus.dmReceived && !signingSecretError}
          />
          <div className="flex-1 space-y-2">
            <p
              className={`text-sm font-medium ${
                currentStep >= 6 ? "" : "text-muted-foreground"
              }`}
            >
              DM the app on Slack to verify the connection
            </p>
            {currentStep === 6 && (
              <div className="rounded-lg border p-3 space-y-2">
                {/* DM Status */}
                <div className="flex items-center gap-2">
                  {verificationStatus.dmReceived && !signingSecretError ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <span className="text-sm">
                    {verificationStatus.dmReceived && !signingSecretError
                      ? "Message received!"
                      : signingSecretError
                        ? "Message received..."
                        : "Waiting for message..."}
                  </span>
                </div>

                {/* Subtitle */}
                <p className="text-xs text-muted-foreground">
                  {signingSecretError
                    ? `There was a problem with the signing secret. Please fix it and DM ${appName} again.`
                    : `Find "${appName}" in the Slack search bar and DM it.`}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between pt-4 border-t">
          {onBack ? (
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          <div className="flex gap-2">
            {onSkip && (
              <Button variant="outline" onClick={onSkip}>
                Skip
              </Button>
            )}
            <Button
              onClick={completeSetup}
              disabled={
                !verificationStatus.dmReceived ||
                completing ||
                signingSecretError
              }
            >
              {completing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Complete Setup
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
