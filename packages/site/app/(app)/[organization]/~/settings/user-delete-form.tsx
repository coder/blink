"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAPIClient } from "@/lib/api-client";
import { AlertTriangle } from "lucide-react";
import { signOut } from "next-auth/react";
import { useState, useTransition } from "react";

export function DeleteUserForm({ userEmail }: { userEmail: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const client = useAPIClient();

  const confirmationLabel = userEmail || "DELETE MY ACCOUNT";
  const isConfirmationValid = confirmationText === confirmationLabel;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmationValid) return;

    setError(null);
    startTransition(async () => {
      try {
        await client.users.delete();
        // Sign the user out and redirect to home
        await signOut({ redirect: true, redirectTo: "/" });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete account"
        );
      }
    });
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setConfirmationText("");
      setError(null);
    }
  };

  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6">
      <div className="flex items-start space-x-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-1 shrink-0" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-destructive mb-2">
            Delete Account
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Once deleted, your account and all associated data will be
            permanently removed. This action cannot be undone.
          </p>

          <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <div>
                <Button variant="destructive" size="sm">
                  Delete My Account
                </Button>
              </div>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Account</DialogTitle>
                <DialogDescription>
                  This cannot be undone. This will permanently delete your
                  account and all chats, messages, and integrations.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="user-delete-confirm"
                    className="text-sm font-medium"
                  >
                    Please type <strong>{confirmationLabel}</strong> to confirm:
                  </label>
                  <Input
                    id="user-delete-confirm"
                    value={confirmationText}
                    onChange={(e) => setConfirmationText(e.target.value)}
                    placeholder={confirmationLabel}
                    disabled={isPending}
                    autoComplete="off"
                  />
                </div>

                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">
                    {error}
                  </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={!isConfirmationValid || isPending}
                  >
                    {isPending ? "Deleting..." : "Confirm Deletion"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
