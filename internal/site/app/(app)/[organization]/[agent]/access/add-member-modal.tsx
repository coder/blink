"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserSelector } from "@/components/user-selector";
import Client from "@blink.so/api";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

interface AddMemberModalProps {
  agentId: string;
  organizationId: string;
  orgAdminsAndOwners?: Set<string>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PERMISSIONS = [
  {
    value: "read" as const,
    label: "Read",
    description: "Use the agent and view their own chats",
  },
  {
    value: "write" as const,
    label: "Write",
    description: "Develop agents and access logs & traces",
  },
  {
    value: "admin" as const,
    label: "Admin",
    description: "Manage settings, access, and all agent features",
  },
];

export function AddMemberModal({
  agentId,
  organizationId,
  orgAdminsAndOwners = new Set(),
  isOpen,
  onClose,
  onSuccess,
}: AddMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [permission, setPermission] = useState<"read" | "write" | "admin">(
    "read"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(() => new Client(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedUserId) {
      setError("Please select a member");
      return;
    }

    setIsSubmitting(true);
    try {
      await client.agents.members.grant({
        agent_id: agentId,
        user_id: selectedUserId,
        permission,
      });

      // Reset form and close
      setSelectedUserId(null);
      setPermission("read");
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSelectedUserId(null);
      setPermission("read");
      setError(null);
      onClose();
    }
  };

  const selectedPermission = PERMISSIONS.find((p) => p.value === permission);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Add Member</DialogTitle>
          <DialogDescription className="text-neutral-500 dark:text-neutral-400">
            Grant a specific member access to this agent
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="member-select"
              className="text-sm font-medium text-neutral-900 dark:text-white"
            >
              Member
            </label>
            <UserSelector
              organizationId={organizationId}
              selectedUserId={selectedUserId}
              onSelect={setSelectedUserId}
              excludeUserIds={orgAdminsAndOwners}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="permission-select"
              className="text-sm font-medium text-neutral-900 dark:text-white"
            >
              Permission
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  type="button"
                  disabled={isSubmitting}
                >
                  <span>
                    {selectedPermission?.label} -{" "}
                    {selectedPermission?.description}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full" align="start">
                {PERMISSIONS.map((perm) => (
                  <DropdownMenuItem
                    key={perm.value}
                    onSelect={() => setPermission(perm.value)}
                    className="cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm">{perm.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {perm.description}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !selectedUserId}>
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                  Adding...
                </>
              ) : (
                "Add Member"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
