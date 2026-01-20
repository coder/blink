"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface AgentDeleteFormProps {
  agentId: string;
  agentName: string;
  organizationName: string;
}

export function AgentDeleteForm({
  agentId,
  agentName,
  organizationName,
}: AgentDeleteFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const client = useAPIClient();

  const requiredConfirmation = `${organizationName}/${agentName}`;
  const isConfirmationValid = confirmationText === requiredConfirmation;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmationValid) return;

    setError(null);

    startTransition(async () => {
      try {
        await client.agents.delete(agentId);
        toast.success("Agent deleted successfully");
        router.push(`/${organizationName}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete agent");
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
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Deleting an agent is permanent and cannot be undone. This will
            remove all associated data, deployments, and configurations.
          </p>

          <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={isPending}
                className="flex items-center space-x-2"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete Agent</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Are you absolutely sure?</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. This will permanently delete the
                  agent <strong>{agentName}</strong> and remove all of its data,
                  deployments, and configurations.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="agent-name-confirm"
                    className="text-sm font-medium"
                  >
                    Please type{" "}
                    <code
                      className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono select-all cursor-text"
                      title="Click to select"
                    >
                      {requiredConfirmation}
                    </code>{" "}
                    to confirm:
                  </label>
                  <Input
                    id="agent-name-confirm"
                    value={confirmationText}
                    onChange={(e) => setConfirmationText(e.target.value)}
                    placeholder={requiredConfirmation}
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
                    {isPending ? "Deleting..." : "Delete Agent"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
