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
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface DeleteOrganizationFormProps {
  organizationId: string;
  organizationName: string;
}

export function DeleteOrganizationForm({
  organizationId,
  organizationName,
}: DeleteOrganizationFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const client = useAPIClient();

  const isConfirmationValid = confirmationText === organizationName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmationValid) return;

    setError(null);

    startTransition(async () => {
      try {
        await client.organizations.delete(organizationId);
        router.push("/");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete organization"
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
          <h3 className="text-lg font-medium text-destructive mb-2">
            Delete Organization
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Once deleted, it will be gone forever. Please be certain. This will
            open a modal to confirm deletion.
          </p>

          <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <div>
                <Button variant="destructive" size="sm">
                  Delete the {organizationName} Organization
                </Button>
              </div>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Organization</DialogTitle>
                <DialogDescription>
                  This cannot be undone. This will permanently delete the
                  organization <strong>{organizationName}</strong> and all
                  chats, messages, and integrations.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="organization-name-confirm"
                    className="text-sm font-medium"
                  >
                    Please type <strong>{organizationName}</strong> to confirm:
                  </label>
                  <Input
                    id="organization-name-confirm"
                    value={confirmationText}
                    onChange={(e) => setConfirmationText(e.target.value)}
                    placeholder={organizationName}
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
