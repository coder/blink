"use client";

import { cn } from "@/lib/utils";
import Client from "@blink.so/api";
import { StarIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export default function AgentPinned({
  agentID,
  pinned,
  variant = "icon",
}: {
  agentID: string;
  pinned: boolean;
  variant?: "button" | "icon";
}) {
  const client = useMemo(() => new Client(), []);
  const [isPending, startTransition] = useTransition();
  const [isPinned, setIsPinned] = useState(pinned);

  return (
    <Tooltip>
      <TooltipTrigger>
        {variant === "icon" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              startTransition(() => {
                if (isPinned) {
                  client.agents.unpin(agentID);
                  setIsPinned(false);
                } else {
                  client.agents.pin(agentID);
                  setIsPinned(true);
                }
              });
            }}
            aria-label={isPinned ? "Unstar agent" : "Star agent"}
          >
            <StarIcon
              className={cn(
                "h-4 w-4 cursor-pointer select-none transition-all duration-250",
                isPending && "animate-pulse"
              )}
              stroke={isPinned ? "var(--color-yellow-500)" : "currentColor"}
              fill={isPinned ? "var(--color-yellow-500)" : "transparent"}
            />
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              startTransition(() => {
                if (isPinned) {
                  client.agents.unpin(agentID);
                  setIsPinned(false);
                } else {
                  client.agents.pin(agentID);
                  setIsPinned(true);
                }
              });
            }}
          >
            <StarIcon
              className={cn(
                "h-6 w-6 cursor-pointer select-none transition-all duration-250",
                isPending && "animate-pulse"
              )}
              stroke={isPinned ? "var(--color-yellow-500)" : "currentColor"}
              fill={isPinned ? "var(--color-yellow-500)" : "transparent"}
            />
            <div>{isPinned ? "Starred" : "Star"}</div>
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {isPinned
          ? "This agent is pinned to your chat list."
          : `Star to pin this agent for quick access.`}
      </TooltipContent>
    </Tooltip>
  );
}
