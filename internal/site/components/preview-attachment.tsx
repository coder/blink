import { FileText, Video, X } from "lucide-react";

import type { UIAttachment } from "@/hooks/use-attachments";
import { cn } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { Button } from "./ui/button";

export const PreviewAttachment = ({
  attachment,
  onRemove,
}: {
  attachment: UIAttachment;
  onRemove?: () => void;
}) => {
  const { id, fileName, contentType, state, progress } = attachment;

  return (
    <div
      data-testid="input-attachment-preview"
      className="flex flex-col gap-2 relative group"
    >
      <div className="w-20 h-16 aspect-video bg-muted rounded-md relative flex flex-col items-center justify-center">
        {contentType ? (
          contentType.startsWith("image") ? (
            state === "uploaded" ? (
              // NOTE: it is recommended to use next/image for images
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={id}
                src={`https://blink.coder.com/api/files/${id}`}
                alt={fileName ?? "An image attachment"}
                className="rounded-md size-full object-cover"
              />
            ) : (
              <div className="" />
            )
          ) : contentType.startsWith("video") ? (
            <div className="flex items-center justify-center size-full bg-black/10 dark:bg-neutral-500/50 rounded-md">
              <Video size={24} className="text-gray-600 dark:text-gray-400" />
            </div>
          ) : (
            <div className="flex items-center justify-center size-full bg-black/10 dark:bg-neutral-500/50 rounded-md">
              <FileText
                size={24}
                className="text-gray-600 dark:text-gray-400"
              />
            </div>
          )
        ) : (
          <div className="flex items-center justify-center size-full bg-black/10 dark:bg-neutral-500/50 rounded-md">
            <FileText size={24} className="text-gray-600 dark:text-gray-400" />
          </div>
        )}

        {state === "uploading" && (
          <div
            data-testid="input-attachment-loader"
            className="animate-spin absolute text-zinc-500 dark:text-zinc-400"
          >
            <LoaderIcon />
          </div>
        )}

        {onRemove && (
          <Button
            data-testid="delete-attachment-button"
            size="icon"
            variant="secondary"
            className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity bg-white dark:bg-black border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label={`Remove attachment ${fileName || "file"}`}
            title={`Remove attachment ${fileName || "file"}`}
          >
            <X
              size={12}
              aria-hidden="true"
              className="text-black dark:text-white"
            />
          </Button>
        )}
      </div>

      {/* Upload Progress Bar */}
      {state === "uploading" && (
        <div className="w-full space-y-1" data-testid="upload-progress-bar">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading...</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-200 ease-out rounded-full",
                progress < 100 ? "bg-blue-500" : "bg-green-500"
              )}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="text-xs text-zinc-500 dark:text-zinc-400 max-w-16 truncate">
        {fileName}
      </div>
    </div>
  );
};
