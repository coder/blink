"use client";

import { Button } from "@/components/ui/button";
import { Activity, Check, Copy, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type LogEntry = {
  timestamp: Date;
  original: string;
  message?: string;
  level: "info" | "error" | "warn";
} & ({ type: "text" } | { type: "json"; parsed: unknown });

interface LogDetailsSidebarProps {
  selectedLog: LogEntry | null;
  isOpen: boolean;
  onClose: () => void;
}

// Helper function to format date in user's timezone with the desired format
const formatTimestamp = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// Helper function to get timezone display
const getTimezoneDisplay = () => {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const sign = offset >= 0 ? "+" : "-";
  return `GMT${sign}${hours}${minutes > 0 ? `:${minutes.toString().padStart(2, "0")}` : ""}`;
};

// Function to flatten nested objects into dot notation
const flattenObject = (
  obj: any,
  prefix = "",
  result: Record<string, any> = {}
): Record<string, any> => {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      if (value === null || value === undefined) {
        result[newKey] = value;
      } else if (Array.isArray(value)) {
        // Handle arrays by indexing each element
        value.forEach((item, index) => {
          const arrayKey = `${newKey}[${index}]`;
          if (typeof item === "object" && item !== null) {
            flattenObject(item, arrayKey, result);
          } else {
            result[arrayKey] = item;
          }
        });
      } else if (typeof value === "object") {
        // Recursively flatten nested objects
        flattenObject(value, newKey, result);
      } else {
        result[newKey] = value;
      }
    }
  }
  return result;
};

export function LogDetailsSidebar({
  selectedLog,
  isOpen,
  onClose,
}: LogDetailsSidebarProps) {
  const params = useParams();
  const router = useRouter();
  const [sidebarWidth, setSidebarWidth] = useState(600);
  const [isResizing, setIsResizing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Use pre-computed JSON data from LogEntry
  const isJSONLog = selectedLog?.type === "json";
  const flattenedData = isJSONLog ? flattenObject(selectedLog.parsed) : null;

  // Extract trace_id and span_id if they exist
  const traceId = flattenedData?.["trace_id"] as string | undefined;
  const spanId = flattenedData?.["span_id"] as string | undefined;
  const hasTraceInfo = !!(traceId || spanId);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const containerRect =
        e.target instanceof Element
          ? e.target
              .closest(".flex.flex-col.max-h-full")
              ?.getBoundingClientRect()
          : null;

      if (containerRect) {
        const newWidth = containerRect.right - e.clientX;
        const minWidth = 280; // Minimum width
        const maxWidth = Math.min(800, containerRect.width * 0.8); // Max 80% of container width
        setSidebarWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
      }
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const copyToClipboard = useCallback(() => {
    if (!selectedLog) return;

    let textToCopy: string;
    try {
      // Try to parse as JSON and stringify with indent
      const parsed = JSON.parse(selectedLog.original);
      textToCopy = JSON.stringify(parsed, null, 2);
    } catch {
      // If parsing fails, just copy the original
      textToCopy = selectedLog.original;
    }

    navigator.clipboard.writeText(textToCopy).then(
      () => {
        toast.success("Copied to clipboard");
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      },
      () => {
        toast.error("Failed to copy");
      }
    );
  }, [selectedLog]);

  const navigateToTrace = useCallback(() => {
    if (!selectedLog || !params.organization || !params.agent) return;

    const filters: {
      type: "and";
      filters: Array<{ type: "eq"; key: string; value: string }>;
    } = {
      type: "and",
      filters: [],
    };

    if (traceId) {
      filters.filters.push({
        type: "eq",
        key: "span.trace_id",
        value: traceId,
      });
    }

    if (spanId) {
      filters.filters.push({
        type: "eq",
        key: "span.id",
        value: spanId,
      });
    }

    // Calculate time range (±15 minutes from log timestamp)
    const logTime = selectedLog.timestamp;
    const startTime = new Date(logTime.getTime() - 15 * 60 * 1000);
    const endTime = new Date(logTime.getTime() + 15 * 60 * 1000);

    // Construct the URL
    const url = new URL(
      `/${params.organization}/${params.agent}/traces`,
      window.location.origin
    );
    url.searchParams.set("filters", JSON.stringify(filters));
    url.searchParams.set("start_time", startTime.toISOString());
    url.searchParams.set("end_time", endTime.toISOString());

    router.push(url.pathname + url.search);
  }, [selectedLog, params.organization, params.agent, traceId, spanId, router]);

  if (!isOpen || !selectedLog) {
    return null;
  }

  return (
    <div
      className="absolute right-0 top-0 bottom-0 bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 flex flex-col"
      style={{ width: sidebarWidth }}
    >
      {/* Resize Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 bg-transparent cursor-ew-resize flex items-center justify-center group hover:bg-blue-500/10 transition-colors"
        onMouseDown={handleMouseDown}
      >
        <div className="w-0.5 h-10 bg-neutral-300 dark:bg-neutral-700 group-hover:bg-blue-500 transition-colors rounded-full" />
      </div>

      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
            Log Details
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="h-8 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title={isJSONLog ? "Copy JSON" : "Copy log"}
          >
            {isCopied ? (
              <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
            ) : (
              <Copy className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
            )}
          </Button>
          {hasTraceInfo && (
            <Button
              variant="outline"
              size="sm"
              onClick={navigateToTrace}
              className="h-8 gap-2 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <Activity className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">View Trace</span>
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <X className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
        </Button>
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 px-6 py-6 overflow-y-auto">
        <div className="space-y-6">
          {/* Timestamp */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2.5 uppercase tracking-wide">
              Time ({getTimezoneDisplay()})
            </label>
            <div className="px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-lg border border-neutral-200 dark:border-neutral-800">
              <span className="text-sm font-mono text-neutral-900 dark:text-neutral-100">
                {formatTimestamp(selectedLog.timestamp)}
              </span>
            </div>
          </div>

          {/* Level */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2.5 uppercase tracking-wide">
              Level
            </label>
            <div className="px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-lg border border-neutral-200 dark:border-neutral-800">
              <span
                className={`inline-flex px-3 py-1.5 text-xs font-medium rounded-md ${
                  selectedLog.level === "error"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400 border border-red-200 dark:border-red-900/50"
                    : selectedLog.level === "warn"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50"
                      : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50"
                }`}
              >
                {selectedLog.level.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2.5 uppercase tracking-wide">
              {isJSONLog ? "JSON Fields" : "Message"}
            </label>
            <div className="bg-neutral-50 dark:bg-neutral-900/50 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
              {isJSONLog && flattenedData ? (
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {(() => {
                    const entries = Object.entries(flattenedData);
                    // Move message field to the front if it exists
                    const messageEntry = entries.find(
                      ([key]) => key === "message"
                    );
                    const otherEntries = entries.filter(
                      ([key]) => key !== "message"
                    );
                    const sortedEntries = messageEntry
                      ? [messageEntry, ...otherEntries]
                      : entries;

                    return sortedEntries.map(([key, value]) => (
                      <div
                        key={key}
                        className="px-4 py-3.5 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/30 transition-colors"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 font-mono">
                            {key}
                          </div>
                          <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100 break-words">
                            {value === null ? (
                              <span className="text-neutral-400 dark:text-neutral-500 italic">
                                null
                              </span>
                            ) : value === undefined ? (
                              <span className="text-neutral-400 dark:text-neutral-500 italic">
                                undefined
                              </span>
                            ) : typeof value === "string" ? (
                              <span className="text-neutral-700 dark:text-neutral-300">
                                &quot;{value}&quot;
                              </span>
                            ) : (
                              <span className="text-neutral-700 dark:text-neutral-300">
                                {String(value)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className="px-4 py-3.5">
                  <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-words leading-relaxed">
                    {selectedLog.original}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
