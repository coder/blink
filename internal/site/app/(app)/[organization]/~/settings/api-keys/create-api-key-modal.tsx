"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Client from "@blink.so/api";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";

interface CreateApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

export function CreateApiKeyModal({
  open,
  onClose,
  userId,
}: CreateApiKeyModalProps) {
  const client = useMemo(() => new Client(), []);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setLoading(true);

    try {
      const result = await client.users.createApiKey({
        name: name || undefined,
        scope: "full",
      });

      setCreatedKey(result.key);
      toast.success("API key created successfully");
      mutate(["api-keys", userId]);
    } catch (error) {
      toast.error("Failed to create API key");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast.success("API key copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (createdKey) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Save this API key somewhere safe. You won't be able to see it
              again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <AlertDescription className="font-mono text-sm break-all">
                {createdKey}
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button
                onClick={handleCopy}
                variant="secondary"
                className="flex-1"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
              <Button onClick={onClose} className="flex-1">
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create new secret key</DialogTitle>
          <DialogDescription>
            Create a new API key to access your organization's resources
            programmatically
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My Test Key"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Optional</p>
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <p className="text-sm text-muted-foreground">
              This key will have full access to all resources
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create secret key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
