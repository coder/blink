"use client";

import { GithubIcon, TrashIcon } from "@/components/icons";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAPIClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function useGitHubAvatarPreview(username: string) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const debouncedUsername = useDebounce(username, 150);

  useEffect(() => {
    if (debouncedUsername.trim()) {
      setIsLoading(true);
      setIsError(false);
      setPreviewUrl(`https://github.com/${debouncedUsername.trim()}.png`);
    } else {
      setPreviewUrl(null);
      setIsLoading(false);
      setIsError(false);
    }
  }, [debouncedUsername]);

  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setIsError(true);
    setIsLoading(false);
  }, []);

  return {
    previewUrl,
    isError,
    isLoading,
    handleImageLoad,
    handleImageError,
  };
}

function GitHubAvatarPreview({
  previewUrl,
  isError,
  isLoading,
  onLoad,
  onError,
}: {
  previewUrl: string | null;
  isError: boolean;
  isLoading: boolean;
  onLoad: () => void;
  onError: () => void;
}) {
  const getPreviewContent = () => {
    if (previewUrl && !isError) {
      return (
        <img
          src={previewUrl}
          alt="GitHub avatar preview"
          className="w-20 h-20 object-cover rounded-md"
          onLoad={onLoad}
          onError={onError}
          style={{ display: isLoading ? "none" : "block", aspectRatio: "1" }}
        />
      );
    }

    if (previewUrl && isError) {
      return (
        <span className="text-xs text-muted-foreground text-center px-2">
          Not found
        </span>
      );
    }

    if (previewUrl && isLoading) {
      return (
        <span className="text-xs text-muted-foreground text-center px-2">
          Loading...
        </span>
      );
    }

    return (
      <span className="text-xs text-muted-foreground text-center px-2">
        Preview
      </span>
    );
  };

  return (
    <div className="flex flex-col items-center">
      <div className="w-20 h-20 border border-border bg-muted flex items-center justify-center rounded-md">
        {getPreviewContent()}
      </div>
    </div>
  );
}

function AvatarActionButtons({
  isAdmin,
  hasAvatar,
  onUploadClick,
  onGitHubClick,
  onRemoveClick,
  isPending,
}: {
  isAdmin: boolean;
  hasAvatar: boolean;
  onUploadClick: () => void;
  onGitHubClick: () => void;
  onRemoveClick: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="flex-1"
        onClick={onUploadClick}
        disabled={!isAdmin || isPending}
      >
        Upload
      </Button>

      <Tooltip>
        <TooltipTrigger asChild disabled={!isAdmin}>
          <Button
            disabled={!isAdmin || isPending}
            variant="outline"
            size="sm"
            onClick={onGitHubClick}
          >
            <GithubIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import from GitHub</TooltipContent>
      </Tooltip>

      {hasAvatar && (
        <Tooltip>
          <TooltipTrigger asChild disabled={!isAdmin}>
            <Button
              disabled={!isAdmin || isPending}
              variant="outline"
              size="sm"
              onClick={onRemoveClick}
            >
              <TrashIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface OrganizationAvatarFormProps {
  organization: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  isAdmin: boolean;
}

export function OrganizationAvatarForm({
  organization,
  isAdmin,
}: OrganizationAvatarFormProps) {
  const [isPending, startTransition] = useTransition();
  const [isGithubDialogOpen, setIsGithubDialogOpen] = useState(false);
  const [githubUsername, setGithubUsername] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const client = useAPIClient();

  const {
    previewUrl: githubPreviewUrl,
    isError: githubImageError,
    isLoading: githubImageLoading,
    handleImageLoad,
    handleImageError,
  } = useGitHubAvatarPreview(githubUsername);

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

        await client.organizations.update(organization.id, {
          avatar_file_id: fileId,
        });
        router.refresh();
        toast.success("Avatar updated successfully");
      } catch (error) {
        console.error("Avatar upload failed:", error);
        toast.error("Failed to upload avatar");
      }
    },
    [organization.id, router, client]
  );

  const handleRemoveAvatar = useCallback(() => {
    startTransition(async () => {
      try {
        await client.organizations.update(organization.id, {
          avatar_file_id: null,
        });
        router.refresh();
        toast.success("Avatar removed successfully");
      } catch (error) {
        console.error("Failed to remove avatar:", error);
        toast.error("Failed to remove avatar");
      }
    });
  }, [organization.id, startTransition, router, client]);

  const handleGithubUsernameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setGithubUsername(e.target.value);
    },
    []
  );

  const handleGithubImport = useCallback(() => {
    if (!githubPreviewUrl || githubImageError) return;
    startTransition(async () => {
      try {
        const githubAvatarUrl = `https://github.com/${githubUsername.trim()}.png`;
        await client.organizations.update(organization.id, {
          avatar_url: githubAvatarUrl,
        });
        setIsGithubDialogOpen(false);
        setGithubUsername("");
        router.refresh();
        toast.success("Avatar imported from GitHub successfully");
      } catch (error) {
        console.error("GitHub avatar import failed:", error);
        toast.error("Failed to import avatar from GitHub");
      }
    });
  }, [
    organization.id,
    githubPreviewUrl,
    githubImageError,
    githubUsername,
    startTransition,
    router,
    client,
  ]);

  const handleGithubDialogClose = useCallback(() => {
    setIsGithubDialogOpen(false);
    setGithubUsername("");
  }, []);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openGithubDialog = useCallback(() => {
    setIsGithubDialogOpen(true);
  }, []);

  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Avatar</label>
        <div className="flex flex-col gap-3">
          <Avatar
            src={organization.avatar_url}
            seed={organization.id}
            alt={`${organization.name} avatar`}
            size={192}
            rounded="lg"
          />
          <div className="flex flex-col gap-2">
            <AvatarActionButtons
              isAdmin={isAdmin}
              hasAvatar={!!organization.avatar_url}
              onUploadClick={openFileDialog}
              onGitHubClick={openGithubDialog}
              onRemoveClick={handleRemoveAvatar}
              isPending={isPending}
            />
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
          disabled={!isAdmin || isPending}
        />
      </div>

      <Dialog open={isGithubDialogOpen} onOpenChange={handleGithubDialogClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Avatar from GitHub</DialogTitle>
          </DialogHeader>
          <div className="flex gap-6">
            <div className="flex-1 space-y-2">
              <label htmlFor="github-username" className="text-sm font-medium">
                GitHub Username or Organization
              </label>
              <Input
                id="github-username"
                type="text"
                autoComplete="off"
                value={githubUsername}
                onChange={handleGithubUsernameChange}
                placeholder="e.g. octocat or github"
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            <GitHubAvatarPreview
              previewUrl={githubPreviewUrl}
              isError={githubImageError}
              isLoading={githubImageLoading}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleGithubDialogClose}>
              Cancel
            </Button>
            <Button
              onClick={handleGithubImport}
              disabled={!githubUsername.trim() || githubImageError || isPending}
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
