"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OrganizationMember } from "@blink.so/api";
import Client from "@blink.so/api";
import { useMemo, useState } from "react";

type OrganizationRole = OrganizationMember["role"];

interface MemberActionsDropdownProps {
  userId?: string;
  organizationId: string;
  userName?: string;
  currentRole?: OrganizationRole;
  // For pending invites
  inviteId?: string;
  inviteEmail?: string;
  // Callbacks
  onUpdated?: () => void;
  onRemoved?: () => void;
  onInviteDeleted?: () => void;
}

type LoadingState = "idle" | "deleting" | "updating" | "removing";
type ErrorState = string | null;

export function MemberActionsDropdown({
  userId,
  organizationId,
  userName,
  currentRole,
  inviteId,
  inviteEmail,
  onUpdated,
  onRemoved,
  onInviteDeleted,
}: MemberActionsDropdownProps) {
  const client = useMemo(() => new Client(), []);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<ErrorState>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<{
    type: "remove" | "delete";
    message: string;
  } | null>(null);
  const [selectedRole, setSelectedRole] = useState<OrganizationRole>("member");

  // Reset state when modals open/close
  const handleOpenRoleModal = () => {
    setSelectedRole(currentRole || "member");
    setError(null);
    setShowRoleModal(true);
  };

  const handleCloseRoleModal = () => {
    setShowRoleModal(false);
    setError(null);
    setLoadingState("idle");
  };

  const handleError = (error: unknown) => {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    setError(message);
    setLoadingState("idle");
  };

  const handleDeleteInvite = async () => {
    if (!inviteId) return;

    const message = inviteEmail
      ? `Are you sure you want to delete the invite for ${inviteEmail}?`
      : "Are you sure you want to delete this invite link?";

    setShowConfirmDialog({
      type: "delete",
      message,
    });
  };

  const handleRemoveMember = async () => {
    if (!userId || !userName) return;

    const message = `Are you sure you want to remove ${userName} from the organization? They will lose access to all organization resources and conversations.`;

    setShowConfirmDialog({
      type: "remove",
      message,
    });
  };

  const confirmAction = async () => {
    if (!showConfirmDialog) return;

    setError(null);

    try {
      if (showConfirmDialog.type === "delete" && inviteId) {
        setLoadingState("deleting");
        await client.invites.delete({
          organization_id: organizationId,
          invite_id: inviteId,
        });
        onInviteDeleted?.();
      } else if (showConfirmDialog.type === "remove" && userId) {
        setLoadingState("removing");
        await client.organizations.members.delete({
          organization_id: organizationId,
          user_id: userId,
        });
        onRemoved?.();
      }
      setShowConfirmDialog(null);
    } catch (error) {
      handleError(error);
    } finally {
      setLoadingState("idle");
    }
  };

  const handleUpdateRole = async () => {
    if (!userId || selectedRole === currentRole) {
      handleCloseRoleModal();
      return;
    }

    setLoadingState("updating");
    setError(null);

    try {
      await client.organizations.members.update({
        organization_id: organizationId,
        user_id: userId,
        role: selectedRole,
      });
      onUpdated?.();
      handleCloseRoleModal();
    } catch (error) {
      handleError(error);
    }
  };

  const isLoading = loadingState !== "idle";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1 rounded"
            aria-label="Open actions menu"
            disabled={isLoading}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-48">
          {/* Member actions */}
          {userId && (
            <>
              <DropdownMenuItem
                onClick={handleOpenRoleModal}
                disabled={isLoading}
              >
                Manage Access
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleRemoveMember}
                disabled={isLoading}
                className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
              >
                {loadingState === "removing" ? "Removing..." : "Remove Member"}
              </DropdownMenuItem>
            </>
          )}

          {/* Invite actions */}
          {inviteId && (
            <DropdownMenuItem
              onClick={handleDeleteInvite}
              disabled={isLoading}
              className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
            >
              {loadingState === "deleting" ? "Deleting..." : "Delete Invite"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <Dialog open={true} onOpenChange={() => setShowConfirmDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-medium">
                {showConfirmDialog.type === "delete"
                  ? "Delete Invite"
                  : "Remove Member"}
              </DialogTitle>
            </DialogHeader>

            <p className="text-neutral-600 dark:text-neutral-400">
              {showConfirmDialog.message}
            </p>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}

            <DialogFooter className="flex flex-row justify-between sm:justify-between">
              <button
                onClick={() => setShowConfirmDialog(null)}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmAction}
                disabled={isLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isLoading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {showConfirmDialog.type === "delete"
                      ? "Deleting..."
                      : "Removing..."}
                  </>
                ) : showConfirmDialog.type === "delete" ? (
                  "Delete"
                ) : (
                  "Remove"
                )}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Role Selection Dialog */}
      <Dialog open={showRoleModal} onOpenChange={handleCloseRoleModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-medium">
              Manage Access
            </DialogTitle>
            <DialogDescription className="text-neutral-500 dark:text-neutral-400">
              Change {userName}'s role and permissions
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {[
              {
                value: "member",
                title: "Member",
                description: "Can view and chat with agents",
              },
              {
                value: "admin",
                title: "Admin",
                description:
                  "Can add/remove users and has admin access to all agents",
              },
            ].map((role) => (
              <label
                key={role.value}
                className={`block p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedRole === role.value
                    ? "border-neutral-300 bg-neutral-50 dark:bg-neutral-800 dark:border-neutral-600"
                    : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                }`}
              >
                <div className="flex items-start space-x-3">
                  <input
                    type="radio"
                    name="role"
                    value={role.value}
                    checked={selectedRole === role.value}
                    onChange={() =>
                      setSelectedRole(role.value as OrganizationRole)
                    }
                    disabled={isLoading}
                    className="mt-0.5 h-4 w-4 text-neutral-600 border-neutral-300 focus:ring-0 focus:ring-offset-0"
                    aria-describedby={`role-${role.value}-description`}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-neutral-900 dark:text-white">
                      {role.title}
                      {currentRole === role.value && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-2">
                          (Current)
                        </span>
                      )}
                    </div>
                    <p
                      id={`role-${role.value}-description`}
                      className="text-sm text-neutral-500 dark:text-neutral-400"
                    >
                      {role.description}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <DialogFooter className="flex flex-row justify-between sm:justify-between">
            <button
              onClick={handleCloseRoleModal}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleUpdateRole}
              disabled={isLoading}
              className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50 transition-colors flex items-center"
            >
              {loadingState === "updating" && (
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              )}
              {loadingState === "updating" ? "Updating..." : "Update Role"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
