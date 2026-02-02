"use client";

import type { SiteRole, SiteUser } from "@blink.so/api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface ChangeRoleModalProps {
  open: boolean;
  user: SiteUser | null;
  onClose: () => void;
  onRoleChanged: (userId: string, newRole: SiteRole) => Promise<void>;
  /** Initial error message to display (for Storybook) */
  initialError?: string;
}

export function ChangeRoleModal({
  open,
  user,
  onClose,
  onRoleChanged,
  initialError,
}: ChangeRoleModalProps) {
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<SiteRole>(
    user?.site_role ?? "member"
  );
  const [error, setError] = useState<string | null>(initialError ?? null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSave = async () => {
    if (!user) return;

    if (selectedRole === user.site_role) {
      handleClose();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onRoleChanged(user.id, selectedRole);
      handleClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message || "Failed to update role");
      } else {
        setError("Failed to update role");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change user role</DialogTitle>
          <DialogDescription>
            Change the role for{" "}
            <strong>{user?.display_name || user?.username}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as SiteRole)}
              className="w-full h-10 px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {selectedRole === "admin"
                ? "Admins have administrative access to the entire site"
                : "Members have standard permissions"}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
