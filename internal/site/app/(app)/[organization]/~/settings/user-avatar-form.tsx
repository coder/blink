"use client";

import { TrashIcon } from "@/components/icons";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAPIClient } from "@/lib/api-client";
import type { User } from "@blink.so/database/schema";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useTransition } from "react";
import { toast } from "sonner";

interface UserAvatarFormProps {
  user: Pick<User, "id" | "display_name" | "email">;
}

export function UserAvatarForm({ user }: UserAvatarFormProps) {
  const { data: session, update } = useSession();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const client = useAPIClient();

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please select a valid image file.");
        return;
      }

      try {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch("/api/files", {
          method: "POST",
          body: fd,
        });
        if (!resp.ok) {
          throw new Error("Upload failed");
        }
        const json = (await resp.json()) as { id: string };
        const fileId = json.id;

        await client.users.update({ avatar_file_id: fileId });

        // Trigger avatar cache refresh in JWT token
        console.log(
          "Avatar form: Calling session.update with refreshAvatar flag"
        );
        await update({ refreshAvatar: true });
        console.log("Avatar form: session.update completed");
        router.refresh();
        toast.success("Avatar updated successfully!");
      } catch (err) {
        console.error("Failed to upload avatar:", err);
        toast.error("Failed to update avatar");
      }
    },
    [router, client, update]
  );

  const handleRemoveAvatar = useCallback(() => {
    startTransition(async () => {
      try {
        await client.users.update({ avatar_file_id: null });

        // Trigger avatar cache refresh in JWT token
        console.log(
          "Avatar form: Calling session.update with refreshAvatar flag (remove)"
        );
        await update({ refreshAvatar: true });
        console.log("Avatar form: session.update completed (remove)");
        router.refresh();
        toast.success("Avatar removed successfully!");
      } catch (e) {
        console.error("Failed to remove avatar:", e);
        toast.error("Failed to update avatar");
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    });
  }, [router, client, update]);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">Avatar</label>
      <div className="flex flex-col gap-3">
        <Avatar
          src={session?.user?.image}
          seed={session?.user?.organization_id ?? user.id}
          alt={user.display_name || "User avatar"}
          size={192}
          rounded="lg"
        />
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={openFileDialog}
              disabled={isPending}
            >
              Upload
            </Button>

            {session?.user?.image && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={isPending}
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveAvatar}
                  >
                    <TrashIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
        disabled={isPending}
      />
    </div>
  );
}
