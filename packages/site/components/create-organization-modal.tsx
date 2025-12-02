"use client";

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
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface CreateOrganizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function CreateOrganizationModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateOrganizationModalProps) {
  const router = useRouter();
  const client = useMemo(() => new Client(), []);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate name format (alphanumeric, hyphens, 1-39 chars)
    const nameRegex = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
    if (!name.trim()) {
      setError("Organization name is required");
      return;
    }
    if (!nameRegex.test(name)) {
      setError(
        "Name must be 1-39 characters, start and end with alphanumeric, and contain only letters, numbers, or hyphens"
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const newOrg = await client.organizations.create({ name });
      setName("");
      onOpenChange(false);
      onSuccess?.();
      router.push(`/${newOrg.name}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create organization"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      if (!newOpen) {
        setName("");
        setError(null);
      }
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>
            Create a new organization to collaborate with your team.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                placeholder="my-organization"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
