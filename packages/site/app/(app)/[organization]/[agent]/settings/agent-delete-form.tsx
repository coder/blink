"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAPIClient } from "@/lib/api-client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  const client = useAPIClient();

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      await client.agents.delete(agentId);
      toast.success("Agent deleted successfully");
      router.push(`/${organizationName}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete agent";
      toast.error(message);
      setIsDeleting(false);
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

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={isDeleting}
                className="flex items-center space-x-2"
              >
                <Trash2 className="h-4 w-4" />
                <span>{isDeleting ? "Deleting..." : "Delete Agent"}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the
                  agent "{agentName}" and remove all of its data from our
                  servers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Delete Agent
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
