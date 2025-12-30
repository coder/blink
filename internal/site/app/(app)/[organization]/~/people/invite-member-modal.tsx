"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Client from "@blink.so/api";
import { useMemo, useState } from "react";
import { RoleDropdown } from "./role-dropdown";

interface InviteMemberModalProps {
  organizationId: string;
  isOpen: boolean;
  onClose: () => void;
  onInviteCreated?: () => void;
}

export function InviteMemberModal({
  organizationId,
  isOpen,
  onClose,
  onInviteCreated,
}: InviteMemberModalProps) {
  const client = useMemo(() => new Client(), []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "billing_admin">(
    "member"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      await client.invites.create({
        organization_id: organizationId,
        email: email.trim(),
        role,
      });

      // Reset form and close
      setEmail("");
      setRole("member");
      onInviteCreated?.();
      onClose();
    } catch (error: any) {
      setError(error.message || "Failed to send invite");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setEmail("");
      setRole("member");
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">
            Invite Member
          </DialogTitle>
          <DialogDescription className="text-neutral-500 dark:text-neutral-400">
            Send an invitation to join your organization
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
              htmlFor="email"
              className="text-sm font-medium text-neutral-900 dark:text-white"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="role"
              className="text-sm font-medium text-neutral-900 dark:text-white"
            >
              Role
            </label>
            <RoleDropdown value={role} onChange={setRole} />
          </div>

          <div className="p-3 bg-muted/50 rounded-lg border">
            <p className="text-sm font-medium mb-2">
              {role === "member" ? "Members" : "Admins"} can:
            </p>
            <ul className="text-xs text-muted-foreground space-y-1">
              {role === "member" ? (
                <>
                  <li>• Create agents (admin on their agents)</li>
                  <li>• Chat and use all agents</li>
                  <li>• View organization activity</li>
                </>
              ) : (
                <>
                  <li>• Admin access to ALL agents</li>
                  <li>• Invite and manage members</li>
                  <li>• Grant agent permissions</li>
                </>
              )}
            </ul>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !email.trim()}>
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                  Sending...
                </>
              ) : (
                "Send Invite"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
