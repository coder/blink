"use client";

import { GithubIcon, LogoGoogle, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Client from "@blink.so/api";
import { Check, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

interface UserAuthenticationClientProps {
  githubAccounts: Array<{ provider_account_id: string }>;
  googleAccounts: Array<{ provider_account_id: string }>;
  hasPassword: boolean;
  personalOrgName: string;
}

export function UserAuthenticationClient({
  githubAccounts,
  googleAccounts,
  hasPassword,
  personalOrgName,
}: UserAuthenticationClientProps) {
  const client = useMemo(() => new Client(), []);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(
    null
  );

  const totalLinked = githubAccounts.length + googleAccounts.length;
  const canSafelyUnlink = hasPassword || totalLinked > 1;

  function ProviderIcon({ provider }: { provider: "github" | "google" }) {
    return provider === "github" ? (
      <GithubIcon size={16} />
    ) : (
      <LogoGoogle size={16} />
    );
  }

  const handleLinkProvider = (provider: "github" | "google") => {
    window.location.href = `/api/auth/signin/${provider}?redirect=/${encodeURIComponent(personalOrgName)}/~/settings`;
  };

  const handleUnlinkProvider = async (
    provider: "github" | "google",
    providerAccountId: string
  ) => {
    if (!canSafelyUnlink) return;

    const unlinkKey = `${provider}-${providerAccountId}`;
    setUnlinkingProvider(unlinkKey);

    try {
      await client.users.unlinkProvider(provider, providerAccountId);
      window.location.reload();
    } catch (error) {
      console.error("Failed to unlink provider:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to unlink provider. Please try again."
      );
      setUnlinkingProvider(null);
    }
  };

  function Row({
    name,
    provider,
    isLinked,
    providerAccountId,
  }: {
    name: string;
    provider: "github" | "google";
    isLinked: boolean;
    providerAccountId?: string;
  }) {
    const status = isLinked ? "Linked" : "Not linked";
    const unlinkKey = providerAccountId
      ? `${provider}-${providerAccountId}`
      : null;
    const isUnlinking = unlinkingProvider === unlinkKey;

    let actions: ReactNode;
    if (isLinked && providerAccountId) {
      const buttonDisabled = !canSafelyUnlink || isUnlinking;
      const button = (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={buttonDisabled}
          aria-label="Unlink"
          className={buttonDisabled ? "pointer-events-none" : undefined}
          onClick={() => handleUnlinkProvider(provider, providerAccountId)}
        >
          <TrashIcon />
        </Button>
      );

      actions = canSafelyUnlink ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center cursor-not-allowed">
              {button}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            You cannot remove your last sign-in method.
          </TooltipContent>
        </Tooltip>
      );
    } else {
      actions = (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleLinkProvider(provider)}
        >
          Link
        </Button>
      );
    }

    return (
      <AuthCard
        icon={<ProviderIcon provider={provider} />}
        title={name}
        content={status}
        actions={actions}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Linked providers</h3>
        <div className="space-y-2">
          <Row
            name="GitHub"
            provider="github"
            isLinked={githubAccounts.length > 0}
            providerAccountId={githubAccounts[0]?.provider_account_id}
          />
          <Row
            name="Google"
            provider="google"
            isLinked={googleAccounts.length > 0}
            providerAccountId={googleAccounts[0]?.provider_account_id}
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-4">Password</h3>
        <AuthCard
          icon={<Lock size={16} />}
          title="Password"
          content={hasPassword ? "Set" : "Not set"}
          actions={
            <Button type="button" variant="outline" size="sm" disabled>
              Change
            </Button>
          }
        />
      </div>
    </div>
  );
}

function AuthCard({
  icon,
  title,
  content,
  actions,
}: {
  icon: ReactNode;
  title: string;
  content: string;
  actions: ReactNode;
}) {
  const isLinked = content === "Linked" || content === "Set";

  return (
    <div className="flex items-center justify-between p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="text-zinc-600 dark:text-zinc-400">{icon}</div>
        <div>
          <div className="font-medium text-zinc-900 dark:text-white">
            {title}
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
            {isLinked && <Check size={14} className="text-green-600" />}
            {content}
          </div>
        </div>
      </div>
      <div>{actions}</div>
    </div>
  );
}
