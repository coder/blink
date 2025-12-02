import { uuidToSlug } from "@/lib/utils";
import type { UIMessage } from "ai";
import { Bug, Link } from "lucide-react";
import { memo } from "react";
import { toast } from "sonner";
import { useCopyToClipboard } from "usehooks-ts";
import { CopyIcon } from "./icons";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

// Strip citation markup from text for clean copy-paste experience
function stripCitations(text: string): string {
  return text.replace(/<blink-citation[^>]*\/?>/gi, "").trim();
}

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  showDebug = false,
}: {
  chatId: string;
  message: UIMessage;
  isLoading: boolean;
  showDebug?: boolean;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();

  if (isLoading) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-row gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="px-1.5 h-5 rounded text-muted-foreground"
              variant="ghost"
              onClick={async () => {
                const textFromParts = message.parts
                  ?.filter((part) => part.type === "text")
                  .map((part) => stripCitations(part.text))
                  .join("\n")
                  .trim();

                if (!textFromParts) {
                  toast.error("There's no text to copy!");
                  return;
                }

                await copyToClipboard(textFromParts);
                toast.success("Copied to clipboard!");
              }}
            >
              <CopyIcon size={10} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="px-1.5 h-5 rounded text-muted-foreground"
              variant="ghost"
              onClick={async () => {
                const chatSlug = uuidToSlug(chatId);
                const messageLink = `${window.location.origin}/chat/${chatSlug}#message-${message.id}`;
                await copyToClipboard(messageLink);
                toast.success("Message link copied to clipboard!");
              }}
            >
              <Link size={10} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy Link</TooltipContent>
        </Tooltip>

        {showDebug && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={`/api/messages/${message.id}/debug`}>
                <Button
                  className="px-1.5 h-5 rounded text-muted-foreground"
                  variant="ghost"
                >
                  <Bug size={10} />
                </Button>
              </a>
            </TooltipTrigger>
            <TooltipContent>Debug</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.showDebug !== nextProps.showDebug) return false;

    return true;
  }
);
