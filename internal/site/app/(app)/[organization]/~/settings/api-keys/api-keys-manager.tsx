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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiKey } from "@blink.so/api";
import Client from "@blink.so/api";
import { type UUID } from "crypto";
import { formatDistanceToNow } from "date-fns";
import { Key, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import { CreateApiKeyModal } from "./create-api-key-modal";

interface ApiKeysManagerProps {
  userId: string;
}

export function ApiKeysManager({ userId }: ApiKeysManagerProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<string | null>(null);
  const client = useMemo(() => new Client(), []);

  const { data: apiKeys } = useSWR(["api-keys", userId], async () => {
    const response = await client.users.listApiKeys();
    return response;
  });

  const handleRevoke = async () => {
    if (!keyToRevoke) return;

    try {
      const response = await client.request(
        "DELETE",
        `/api/users/me/api-keys/${keyToRevoke as UUID}`
      );
      if (!response.ok) {
        throw new Error("Failed to revoke API key");
      }
      toast.success("API key revoked successfully");
      setKeyToRevoke(null);
      mutate(["api-keys", userId]);
    } catch (error) {
      toast.error("Failed to revoke API key");
    }
  };

  // Filter out revoked keys
  const activeKeys: ApiKey[] =
    apiKeys?.items?.filter((key: ApiKey) => !key.revoked_at) || [];

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex  justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">API Keys</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage API keys for access to deployment resources.
            </p>
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create new secret key
          </Button>
        </div>

        {activeKeys.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No API keys yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first API key to start using the API
            </p>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create new secret key
            </Button>
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">
                      {key.name || "Untitled key"}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm">
                          {key.key_prefix}...{key.key_suffix}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge>Full access</Badge>
                    </TableCell>
                    <TableCell>
                      {formatDistanceToNow(new Date(key.created_at), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell>
                      {key.last_used_at
                        ? formatDistanceToNow(new Date(key.last_used_at), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      {key.expires_at
                        ? formatDistanceToNow(new Date(key.expires_at), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setKeyToRevoke(key.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {showCreateModal && (
        <CreateApiKeyModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          userId={userId}
        />
      )}

      <AlertDialog
        open={!!keyToRevoke}
        onOpenChange={() => setKeyToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this API key? This action cannot
              be undone and any applications using this key will lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
