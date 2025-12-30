"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Client from "@blink.so/api";
import { useEffect, useMemo, useState } from "react";

interface InviteLink {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

interface InviteLinkModalProps {
  organizationId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function InviteLinkModal({
  organizationId,
  isOpen,
  onClose,
}: InviteLinkModalProps) {
  const client = useMemo(() => new Client(), []);
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedTokens, setCopiedTokens] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      loadInviteLinks();
    }
  }, [isOpen]);

  const loadInviteLinks = async () => {
    setIsLoading(true);
    try {
      const invites = await client.invites.list({
        organization_id: organizationId,
      });

      // Filter for reusable invites only and map to our format
      const inviteLinks = invites
        .filter((invite) => invite.reusable)
        .map((invite) => ({
          id: invite.id,
          token: invite.code,
          expiresAt: new Date(invite.expires_at),
          createdAt: new Date(invite.created_at),
        }));

      // Filter out expired invites and delete them automatically
      const now = new Date();
      const validInvites = [];
      for (const invite of inviteLinks) {
        if (invite.expiresAt <= now) {
          // Automatically delete expired invite
          try {
            await client.invites.delete({
              organization_id: organizationId,
              invite_id: invite.id,
            });
          } catch (error) {
            console.error("Failed to delete expired invite:", error);
          }
        } else {
          validInvites.push(invite);
        }
      }

      setInviteLinks(validInvites);
    } catch (error: any) {
      alert(`Failed to load invite links: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const createInviteLink = async () => {
    setIsCreating(true);
    try {
      await client.invites.create({
        organization_id: organizationId,
        role: "member",
        reusable: true,
      });

      // Reload the invite links to show the new one
      await loadInviteLinks();
    } catch (error: any) {
      alert(`Failed to create invite link: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const copyToClipboard = async (token: string) => {
    const inviteUrl = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedTokens((prev) => new Set(prev).add(token));
      setTimeout(() => {
        setCopiedTokens((prev) => {
          const newSet = new Set(prev);
          newSet.delete(token);
          return newSet;
        });
      }, 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = inviteUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedTokens((prev) => new Set(prev).add(token));
      setTimeout(() => {
        setCopiedTokens((prev) => {
          const newSet = new Set(prev);
          newSet.delete(token);
          return newSet;
        });
      }, 2000);
    }
  };

  const handleClose = () => {
    setInviteLinks([]);
    setCopiedTokens(new Set());
    onClose();
  };

  // Format expiration date
  const formatExpirationDate = (date: Date) => {
    return `Expires ${date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  };

  const currentInvite = inviteLinks[0]; // Most recent invite link
  const inviteUrl = currentInvite
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${currentInvite.token}`
    : "";
  const isCopied = currentInvite && copiedTokens.has(currentInvite.token);

  const handleGenerateNew = async () => {
    // Delete existing invite links first
    if (currentInvite) {
      try {
        await client.invites.delete({
          organization_id: organizationId,
          invite_id: currentInvite.id,
        });
      } catch (error) {
        console.error("Failed to delete old invite:", error);
      }
    }
    // Create new invite link
    await createInviteLink();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg overflow-visible">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Invite Link</DialogTitle>
          <DialogDescription className="text-neutral-500 dark:text-neutral-400">
            Share this link to invite team members
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-neutral-600"></div>
              <span className="ml-3 text-sm text-neutral-600 dark:text-neutral-400">
                Loading...
              </span>
            </div>
          ) : currentInvite ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inviteUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm focus:ring-2 focus:ring-neutral-500 focus:border-neutral-500"
                  />
                  <button
                    onClick={() => copyToClipboard(currentInvite.token)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isCopied
                        ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                        : "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
                    }`}
                  >
                    {isCopied ? (
                      <span className="flex items-center gap-1">
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Copied
                      </span>
                    ) : (
                      "Copy"
                    )}
                  </button>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {formatExpirationDate(currentInvite.expiresAt)}
                </p>
              </div>

              <button
                onClick={handleGenerateNew}
                disabled={isCreating}
                className="w-full px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white border border-neutral-300 dark:border-neutral-600 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 transition-colors"
              >
                {isCreating ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                    Generating...
                  </span>
                ) : (
                  "Generate New Link (invalidates current)"
                )}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-center py-4 text-neutral-500 dark:text-neutral-400 text-sm">
                No invite link yet. Generate one to get started.
              </p>
              <button
                onClick={createInviteLink}
                disabled={isCreating}
                className="w-full px-4 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg text-sm font-medium hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50 transition-colors"
              >
                {isCreating ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                    Generating...
                  </span>
                ) : (
                  "Generate Link"
                )}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
