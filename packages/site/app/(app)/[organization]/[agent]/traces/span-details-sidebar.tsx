"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OtelSpan } from "@blink.so/api";
import { Check, Copy, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogLevelBadge, SpanStatusBadge } from "./status-badges";
import { formatDuration, formatTimestamp, getTimezoneDisplay } from "./utils";

export interface AgentLog {
  timestamp: Date;
  message: string;
  level: "info" | "error" | "warn";
}

export type LogEntry = AgentLog & {
  original: string;
  type: "text" | "json";
  parsed?: unknown;
};

interface SpanDetailsSidebarProps {
  selectedSpan: OtelSpan | null;
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  logs: LogEntry[];
  logsLoading: boolean;
  logsError: string | null;
}

// Function to flatten nested objects into dot notation
// Skips null and undefined values
const flattenObject = (
  obj: any,
  prefix = "",
  result: Record<string, string> = {}
): Record<string, string> => {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      // Skip null and undefined values
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        // Handle arrays by indexing each element
        value.forEach((item, index) => {
          const arrayKey = `${newKey}[${index}]`;
          if (typeof item === "object" && item !== null) {
            flattenObject(item, arrayKey, result);
          } else if (item !== null && item !== undefined) {
            result[arrayKey] = String(item);
          }
        });
      } else if (typeof value === "object") {
        // Recursively flatten nested objects
        flattenObject(value, newKey, result);
      } else {
        // Convert all primitive values to strings
        result[newKey] = String(value);
      }
    }
  }
  return result;
};

// Function to try parsing a string as JSON
export const tryParseJSON = (str: string): { isJSON: boolean; data?: any } => {
  try {
    const parsed = JSON.parse(str);
    // Only consider it JSON if it's an object or array
    if (typeof parsed === "object" && parsed !== null) {
      return { isJSON: true, data: parsed };
    }
    return { isJSON: false };
  } catch {
    return { isJSON: false };
  }
};

// Helper function to format date for logs
const formatLogTimestamp = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

export function SpanDetailsSidebar({
  selectedSpan,
  isOpen,
  onClose,
  agentId,
  logs,
  logsLoading,
  logsError,
}: SpanDetailsSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(600);
  const [isResizing, setIsResizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"fields" | "logs">("fields");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [copiedLog, setCopiedLog] = useState<LogEntry | null>(null);

  const handleCopyLog = useCallback((log: LogEntry, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedLog(log);
    setTimeout(() => {
      setCopiedLog(null);
    }, 2000);
  }, []);

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
        const minWidth = 280;
        const maxWidth = Math.min(800, containerRect.width * 0.8);
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

  // Flatten the entire payload
  const flattenedFields = useMemo(() => {
    if (!selectedSpan) return {};
    const flattened = flattenObject(selectedSpan.payload);
    // Sort with span. fields first, then alphabetically
    return Object.fromEntries(
      Object.entries(flattened).sort(([a], [b]) => {
        const aIsSpan = a.startsWith("span.");
        const bIsSpan = b.startsWith("span.");

        if (aIsSpan && !bIsSpan) return -1;
        if (!aIsSpan && bIsSpan) return 1;

        return a.localeCompare(b);
      })
    );
  }, [selectedSpan]);

  // Filter fields based on search query
  const filteredFields = useMemo(() => {
    if (!searchQuery) return flattenedFields;
    const query = searchQuery.toLowerCase();
    return Object.fromEntries(
      Object.entries(flattenedFields).filter(
        ([key, value]) =>
          key.toLowerCase().includes(query) ||
          value.toLowerCase().includes(query)
      )
    );
  }, [flattenedFields, searchQuery]);

  // Filter logs based on search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery) return logs;
    const query = searchQuery.toLowerCase();
    return logs.filter(
      (log) =>
        log.message.toLowerCase().includes(query) ||
        log.level.toLowerCase().includes(query)
    );
  }, [logs, searchQuery]);

  // Reset search and selected log when switching tabs
  useEffect(() => {
    setSearchQuery("");
    setSelectedLog(null);
  }, [activeTab]);

  if (!isOpen || !selectedSpan) {
    return null;
  }

  const span = selectedSpan.payload.span;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-700 shadow-lg shadow-black/20 dark:shadow-black/40 z-50 flex flex-col"
      style={{ width: sidebarWidth }}
    >
      {/* Resize Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 bg-transparent cursor-ew-resize flex items-center justify-center group"
        onMouseDown={handleMouseDown}
      >
        <div className="w-0.5 h-8 bg-neutral-300 dark:bg-neutral-600" />
      </div>

      {/* Sidebar Header */}
      <div className="flex items-start justify-between p-4 pl-6">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {span.name}
            </h3>
            <SpanStatusBadge statusCode={span.status_code} />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-500 dark:text-neutral-400">
            <span>
              {formatTimestamp(selectedSpan.start_time)} →{" "}
              {formatTimestamp(selectedSpan.end_time)}
            </span>
            <span className="inline-flex px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-800 rounded">
              {getTimezoneDisplay()}
            </span>
            <span className="inline-flex px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-800 rounded">
              {formatDuration(span.duration_ns)}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="p-1 h-auto flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700 px-4 pl-6">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "fields"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
          onClick={() => setActiveTab("fields")}
        >
          Fields
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "logs"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
          onClick={() => setActiveTab("logs")}
        >
          Logs
          <span className="ml-2 inline-flex px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-800 rounded">
            {logs.length}
          </span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pl-6 pt-4 pb-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              type="text"
              placeholder={
                activeTab === "fields" ? "Search fields..." : "Search logs..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Fields Tab */}
        {activeTab === "fields" && (
          <div className="flex-1 overflow-y-auto border-t border-neutral-200 dark:border-neutral-700">
            <div className="bg-neutral-50 dark:bg-neutral-800/30">
              {Object.entries(filteredFields).length === 0 ? (
                <div className="p-8 text-center text-neutral-500 dark:text-neutral-400">
                  {searchQuery ? "No fields match your search" : "No fields"}
                </div>
              ) : (
                <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
                  {Object.entries(filteredFields).map(([key, value]) => (
                    <div
                      key={key}
                      className="p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                          {key}
                        </div>
                        <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100 break-all">
                          {value === "" ? (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 rounded italic">
                              Empty string
                            </span>
                          ) : (
                            value
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === "logs" && (
          <div className="flex-1 overflow-y-auto border-t border-neutral-200 dark:border-neutral-700">
            {logsLoading ? (
              <div className="p-8 text-center text-neutral-500 dark:text-neutral-400">
                Loading logs...
              </div>
            ) : logsError ? (
              <div className="p-8 text-center text-red-500 dark:text-red-400">
                <p className="font-medium mb-2">Error loading logs</p>
                <p className="text-sm">{logsError}</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-neutral-500 dark:text-neutral-400">
                {searchQuery
                  ? "No logs match your search"
                  : "No logs found for this span"}
              </div>
            ) : (
              <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
                {filteredLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`p-3 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50 ${
                      selectedLog === log
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : ""
                    }`}
                    onClick={() =>
                      setSelectedLog(selectedLog === log ? null : log)
                    }
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                          {formatLogTimestamp(log.timestamp)}
                        </span>
                        <LogLevelBadge level={log.level} />
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-sm font-mono text-neutral-900 dark:text-neutral-100 break-all">
                          {log.type === "json" &&
                          log.parsed &&
                          typeof log.parsed === "object" &&
                          "message" in log.parsed
                            ? String(
                                (log.parsed as Record<string, any>).message
                              )
                            : log.message}
                        </span>
                      </div>
                      {selectedLog === log && log.type === "json" && (
                        <div className="mt-2 p-2 bg-neutral-100 dark:bg-neutral-800 rounded text-xs font-mono overflow-x-auto relative">
                          <button
                            className="absolute top-2 right-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyLog(
                                log,
                                JSON.stringify(log.parsed, null, 2)
                              );
                            }}
                            title="Copy to clipboard"
                          >
                            {copiedLog === log ? (
                              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                            ) : (
                              <Copy className="h-3 w-3 text-neutral-600 dark:text-neutral-400" />
                            )}
                          </button>
                          <pre className="text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-all">
                            {JSON.stringify(log.parsed, null, 2)}
                          </pre>
                        </div>
                      )}
                      {selectedLog === log && log.type === "text" && (
                        <div className="mt-2 p-2 bg-neutral-100 dark:bg-neutral-800 rounded text-xs font-mono relative">
                          <button
                            className="absolute top-2 right-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyLog(log, log.message);
                            }}
                            title="Copy to clipboard"
                          >
                            {copiedLog === log ? (
                              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                            ) : (
                              <Copy className="h-3 w-3 text-neutral-600 dark:text-neutral-400" />
                            )}
                          </button>
                          <div className="text-neutral-900 dark:text-neutral-100 break-all pr-6">
                            {log.message}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
