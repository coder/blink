"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAPIClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { OrganizationAvatarForm } from "./organization-avatar-form";

interface OrganizationProfileFormProps {
  organization: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  isAdmin: boolean;
}

export function OrganizationProfileForm({
  organization,
  isAdmin,
}: OrganizationProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(organization.name || "");
  const router = useRouter();
  const client = useAPIClient();

  const hasChanges = name !== (organization.name || "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return;

    startTransition(async () => {
      try {
        const updatedOrg = await client.organizations.update(organization.id, {
          name: name.trim(),
        });

        toast.success("Organization updated successfully");

        // Only redirect if the name actually changed
        if (updatedOrg.name !== organization.name) {
          router.push(`/${updatedOrg.name}/~/settings`);
        } else {
          router.refresh();
        }
      } catch (error) {
        console.error("Failed to update organization:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update organization"
        );
      }
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between lg:gap-16 space-y-8 lg:space-y-0">
            <div className="flex-1 space-y-8">
              <div className="space-y-2">
                <label
                  htmlFor="organization_name"
                  className="text-sm font-medium text-foreground"
                >
                  Name
                </label>
                <Input
                  id="organization_name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter organization name"
                  maxLength={100}
                  disabled={!isAdmin}
                />
              </div>

              {isAdmin && (
                <div className="flex">
                  <Button
                    onClick={handleSubmit}
                    disabled={!hasChanges || isPending}
                  >
                    {isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              )}
            </div>

            <OrganizationAvatarForm
              organization={organization}
              isAdmin={isAdmin}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
