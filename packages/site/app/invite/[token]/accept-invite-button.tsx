"use client";

import { useAPIClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AcceptInviteButtonProps {
  inviteId: string;
  code: string;
  redirect: string;
}

export function AcceptInviteButton({
  inviteId,
  code,
  redirect,
}: AcceptInviteButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const client = useAPIClient();

  const handleAccept = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await client.invites.accept({ invite_id: inviteId, code });

      // Redirect after successful acceptance
      router.push(redirect);
    } catch (err: any) {
      setError(err?.message || "Failed to accept invite");
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
          role="alert"
          aria-live="polite"
        >
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleAccept}
        disabled={isLoading}
        className="w-full bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 dark:bg-neutral-100 dark:hover:bg-neutral-200 dark:disabled:bg-neutral-600 text-white dark:text-neutral-900 font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center"
      >
        {isLoading ? "Accepting..." : "Accept Invite"}
      </button>
    </div>
  );
}
