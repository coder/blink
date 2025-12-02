"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAPIClient } from "@/lib/api-client";
import type { UserWithPersonalOrganization } from "@blink.so/database/schema";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserAvatarForm } from "./user-avatar-form";

interface UserProfileFormProps {
  user: Pick<
    UserWithPersonalOrganization,
    "id" | "display_name" | "email" | "username" | "organization_id"
  >;
}

export function UserProfileForm({ user }: UserProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(user.display_name || "");
  const [username, setUsername] = useState(user.username || "");
  const [email, setEmail] = useState(user.email || "");
  const router = useRouter();
  const client = useAPIClient();

  const hasNameChanges = name !== (user.display_name || "");
  const hasUsernameChanges = username !== (user.username || "");
  const hasChanges = hasNameChanges || hasUsernameChanges;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return;

    startTransition(async () => {
      try {
        const updatedUser = await client.users.update({
          display_name: hasNameChanges ? name : undefined,
          username: hasUsernameChanges ? username : undefined,
        });

        toast.success("Profile updated successfully");

        // Only redirect if the username actually changed
        if (hasUsernameChanges && updatedUser.username !== user.username) {
          router.push(`/${updatedUser.username}/~/settings`);
        } else {
          router.refresh();
        }
      } catch (error) {
        console.error("Failed to update profile:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to update profile"
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
                  htmlFor="username"
                  className="text-sm font-medium text-foreground"
                >
                  Username
                </label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="Enter your username"
                  maxLength={39}
                  pattern="[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}"
                />
                <p className="text-sm text-muted-foreground">
                  Lowercase letters, numbers, and hyphens only. Cannot start or
                  end with a hyphen.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="user_name"
                  className="text-sm font-medium text-foreground"
                >
                  Display Name
                </label>
                <Input
                  id="user_name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={100}
                />
              </div>

              <div className="flex">
                <Button
                  onClick={handleSubmit}
                  disabled={!hasChanges || isPending}
                >
                  {isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>

            <UserAvatarForm user={user} />
          </div>
        </form>
      </div>
    </div>
  );
}
