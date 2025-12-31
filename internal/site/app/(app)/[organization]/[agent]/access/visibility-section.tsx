"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Client from "@blink.so/api";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function VisibilitySection({
  agentId,
  currentVisibility,
  organizationName,
}: {
  agentId: string;
  currentVisibility: "private" | "public" | "organization";
  organizationName: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [localVisibility, setLocalVisibility] = useState(currentVisibility);
  const client = useMemo(() => new Client(), []);
  const router = useRouter();

  const updateVisibility = async (
    visibility: "private" | "public" | "organization"
  ) => {
    setLocalVisibility(visibility);
    await client.agents.update({
      id: agentId,
      visibility,
    });
    setIsEditing(false);
    router.refresh();
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900 dark:text-white">
          Access Scope
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Control who can discover and access this agent.
        </p>
      </div>

      {!isEditing ? (
        <div className="border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {localVisibility === "private" ? (
                <svg
                  className="h-5 w-5 text-neutral-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              ) : localVisibility === "organization" ? (
                <svg
                  className="h-5 w-5 text-neutral-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5 text-neutral-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-neutral-900 dark:text-white">
                    {localVisibility === "private"
                      ? "Restricted"
                      : localVisibility === "organization"
                        ? "Team"
                        : "Public"}
                  </p>
                  {localVisibility === "private" && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-neutral-400 hover:text-neutral-500"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-sm">
                            This only restricts access via the Blink UI.
                            External integrations (like Slack) may still have
                            access if configured.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {localVisibility === "private"
                    ? `Only members with explicit permissions can access`
                    : localVisibility === "organization"
                      ? `All members of ${organizationName} can discover and access`
                      : `Anyone with the link can access`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="relative flex cursor-pointer rounded-lg border border-neutral-300 dark:border-neutral-700 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
            <input
              type="radio"
              name="visibility"
              value="private"
              checked={localVisibility === "private"}
              onChange={() => updateVisibility("private")}
              className="mt-0.5 h-4 w-4 shrink-0 border-neutral-300 text-blue-600 focus:ring-blue-600"
            />
            <div className="ml-3">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-neutral-900 dark:text-white">
                  Restricted
                </p>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-neutral-400 hover:text-neutral-500"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-sm">
                        This only restricts access via the Blink UI. External
                        integrations (like Slack) may still have access if
                        configured.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Only members with explicit permissions can access
              </p>
            </div>
          </label>
          <label className="relative flex cursor-pointer rounded-lg border border-neutral-300 dark:border-neutral-700 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
            <input
              type="radio"
              name="visibility"
              value="organization"
              checked={localVisibility === "organization"}
              onChange={() => updateVisibility("organization")}
              className="mt-0.5 h-4 w-4 shrink-0 border-neutral-300 text-blue-600 focus:ring-blue-600"
            />
            <div className="ml-3">
              <p className="text-sm font-medium text-neutral-900 dark:text-white">
                Team
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                All members of {organizationName} can discover and access
              </p>
            </div>
          </label>
          <button
            onClick={() => setIsEditing(false)}
            className="text-sm text-neutral-600 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
