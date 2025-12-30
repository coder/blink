"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldFilterGroup } from "@blink.so/api";
import Client from "@blink.so/api";
import { Activity, AlertCircle, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TraceFiltersContent,
  TraceFiltersPanel,
} from "../traces/trace-filters-panel";
import {
  DateRangeFilter,
  getDateRangeValues,
  type DateRange,
} from "./date-range-filter";
import { LogDetailsSidebar } from "./log-details-sidebar";

const client = new Client();

const LOG_FILTER_FIELDS: readonly string[] = [];

type LogEntry = {
  timestamp: Date;
  original: string;
  message?: string;
  level: "info" | "error" | "warn";
} & ({ type: "text" } | { type: "json"; parsed: unknown });

// Function to try parsing a string as JSON
const tryParseJSON = (str: string): { isJSON: boolean; data?: any } => {
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

const hasTraceDetails = (log: LogEntry): boolean => {
  return (
    log.type === "json" &&
    log.parsed != null &&
    typeof log.parsed === "object" &&
    ("trace_id" in log.parsed || "span_id" in log.parsed)
  );
};

export interface AgentLogsProps {
  agentId: string;
  organizationId: string;
  agentName: string;
  initialFilters?: FieldFilterGroup;
  initialStartTime?: Date;
  initialEndTime?: Date;
  initialSearchQuery?: string;
}

export function AgentLogs({
  agentId,
  organizationId,
  agentName,
  initialFilters,
  initialStartTime,
  initialEndTime,
  initialSearchQuery,
}: AgentLogsProps) {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    if (initialStartTime && initialEndTime) {
      return {
        from: {
          id: "custom",
          label: initialStartTime.toLocaleDateString(),
          value: initialStartTime,
        },
        to: {
          id: "custom",
          label: initialEndTime.toLocaleDateString(),
          value: initialEndTime,
        },
        fromCustom: initialStartTime,
        toCustom: initialEndTime,
      };
    }
    return {
      from: {
        id: "24h",
        label: "24 hours ago",
        value: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      to: {
        id: "now",
        label: "Now",
        value: "now",
      },
    };
  });
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(
    initialSearchQuery || ""
  );
  const [filters, setFilters] = useState<FieldFilterGroup>(
    initialFilters || {
      type: "and",
      filters: [],
    }
  );
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Stabilize filters to prevent unnecessary refetches when logically equivalent
  const stableFilters = useMemo(() => {
    const validFilters = filters.filters.filter(
      (f) => f.type === "eq" && f.key !== ""
    );
    return {
      type: filters.type,
      filters: validFilters,
    } as FieldFilterGroup;
  }, [
    JSON.stringify(
      filters.filters.filter((f) => f.type === "eq" && f.key !== "")
    ),
  ]);

  // Data state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sidebar state
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleDateRangeChange = (newDateRange: DateRange) => {
    setDateRange(newDateRange);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const handleFiltersChange = (newFilters: FieldFilterGroup) => {
    setFilters(newFilters);
  };

  // Debounce search query to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500); // 500ms delay

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    if (!organizationId) return;

    setLoading(true);
    try {
      const { from: fromDate, to: toDate } = getDateRangeValues(dateRange);

      const response = await client.agents.logs.logs({
        agent_id: agentId,
        start_time: fromDate,
        end_time: toDate,
        limit: 500,
        message_pattern: debouncedSearchQuery.trim() || undefined,
        filters: stableFilters.filters.length > 0 ? stableFilters : undefined,
      });

      const responseData: LogEntry[] = response.logs.map((log) => {
        const parseResult = tryParseJSON(log.message);

        if (parseResult.isJSON) {
          // Extract message field from JSON if it exists
          const jsonMessage =
            parseResult.data &&
            typeof parseResult.data === "object" &&
            "message" in parseResult.data &&
            typeof parseResult.data.message === "string"
              ? String(parseResult.data.message)
              : undefined;

          return {
            timestamp: log.timestamp,
            original: log.message,
            message: jsonMessage,
            level: log.level,
            type: "json" as const,
            parsed: parseResult.data,
          };
        } else {
          return {
            timestamp: log.timestamp,
            original: log.message,
            message: log.message,
            level: log.level,
            type: "text" as const,
          };
        }
      });
      setLogs(responseData);
      setError(null);
    } catch (err) {
      console.error("Error fetching logs:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, dateRange, agentId, debouncedSearchQuery, stableFilters]);

  // Load logs when filters change with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 500);

    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const handleReload = () => {
    fetchLogs();
  };

  const handleLogClick = (log: LogEntry) => {
    setSelectedLog(log);
    setSidebarOpen(true);
  };

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
    setSelectedLog(null);
  };

  // Agent Logs is a full-screen component - it fills up the entire available space on the page
  // but not more. If you change that behavior, you must also update the logs sidebar. Otherwise,
  // it will not display correctly when you scroll down a large list of logs.
  return (
    <div className="flex flex-col flex-1 max-h-full min-h-full relative bg-white dark:bg-neutral-950">
      <div className="flex flex-col p-6 space-y-4 flex-1 min-h-0 max-h-full overflow-y-scroll">
        {/* Filter and Search Row */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400 dark:text-neutral-500 h-4 w-4" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10 h-9 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 focus:border-neutral-400 dark:focus:border-neutral-600 transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              <TraceFiltersPanel
                filters={filters}
                onFiltersChange={handleFiltersChange}
                isExpanded={filtersExpanded}
                onToggleExpanded={() => setFiltersExpanded(!filtersExpanded)}
                availableFields={LOG_FILTER_FIELDS}
              />
              <DateRangeFilter
                dateRange={dateRange}
                onDateRangeChange={handleDateRangeChange}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleReload}
                className="px-3 h-9 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {filtersExpanded && (
            <TraceFiltersContent
              filters={filters}
              onFiltersChange={handleFiltersChange}
              availableFields={LOG_FILTER_FIELDS}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 bg-white dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm flex flex-col min-h-0">
          {error ? (
            <div className="flex flex-col flex-1 items-center justify-center p-12">
              <div className="max-w-md text-center space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50">
                  <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
                    Error Loading Logs
                  </h2>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {error}
                  </p>
                </div>
                <Button
                  onClick={handleReload}
                  variant="outline"
                  className="mt-4"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 overflow-y-scroll scrollbar-transparent">
                <div
                  className="grid"
                  style={{ gridTemplateColumns: "auto auto 1fr" }}
                >
                  {/* Table Header */}
                  <div className="contents">
                    <div className="sticky top-0 px-3 py-2 flex items-center bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-sm text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 z-10">
                      Time ({getTimezoneDisplay()})
                    </div>
                    <div className="sticky top-0 px-3 py-2 flex items-center bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-sm text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 z-10">
                      Level
                    </div>
                    <div className="sticky top-0 px-3 py-2 flex items-center bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-sm text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 z-10">
                      Message
                    </div>
                  </div>
                  {/* Skeleton Rows */}
                  {Array.from({ length: 20 }).map((_, index) => (
                    <div key={index} className="col-span-3 px-3 py-2.5">
                      <div
                        className="h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse"
                        style={{
                          width: `${Math.random() * 40 + 50}%`,
                          animationDelay: `${index * 50}ms`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-12">
              <div className="text-center max-w-md space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                  <Activity className="h-8 w-8 text-neutral-400 dark:text-neutral-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
                    No Logs Found
                  </h2>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    No logs found for the selected filters. Try adjusting your
                    date range or search terms.
                  </p>
                </div>
                <div className="pt-2 px-6 py-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
                  <div className="font-medium text-neutral-700 dark:text-neutral-300">
                    Current filters:
                  </div>
                  <div>
                    Agent: <span className="font-mono">{agentName}</span>
                  </div>
                  <div>
                    Time:{" "}
                    <span className="font-mono">
                      {dateRange.from.id === "custom" && dateRange.fromCustom
                        ? `${dateRange.fromCustom.toLocaleDateString()} ${dateRange.fromCustom.toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}`
                        : dateRange.from.label}
                    </span>{" "}
                    to{" "}
                    <span className="font-mono">
                      {dateRange.to.id === "custom" && dateRange.toCustom
                        ? `${dateRange.toCustom.toLocaleDateString()} ${dateRange.toCustom.toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}`
                        : dateRange.to.label.toLowerCase()}
                    </span>
                  </div>
                  {searchQuery && (
                    <div>
                      Search:{" "}
                      <span className="font-mono">
                        &quot;{searchQuery}&quot;
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-scroll scrollbar-transparent overflow-x-auto">
                <div
                  className="grid"
                  style={{ gridTemplateColumns: "auto auto 1fr" }}
                >
                  {/* Table Header */}
                  <div className="contents">
                    <div className="sticky top-0 px-3 py-2 flex items-center bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-sm text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 z-10">
                      Time ({getTimezoneDisplay()})
                    </div>
                    <div className="sticky top-0 px-3 py-2 flex items-center bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-sm text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 z-10">
                      Level
                    </div>
                    <div className="sticky top-0 px-3 py-2 flex items-center bg-neutral-50/80 dark:bg-neutral-900/80 backdrop-blur-sm text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 z-10">
                      Message
                    </div>
                  </div>
                  {/* Table Body */}
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className="contents group cursor-pointer"
                      onClick={() => handleLogClick(log)}
                    >
                      <div className="px-3 py-2 flex items-center text-xs text-neutral-600 dark:text-neutral-400 font-mono whitespace-nowrap group-hover:bg-neutral-50 dark:group-hover:bg-neutral-800/30 border-l-2 border-transparent group-hover:border-blue-500 dark:group-hover:border-blue-500 transition-colors">
                        {formatTimestamp(log.timestamp)}
                      </div>
                      <div className="px-3 py-2 flex items-center whitespace-nowrap group-hover:bg-neutral-50 dark:group-hover:bg-neutral-800/30 transition-colors">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded w-fit ${
                            log.level === "error"
                              ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400 border border-red-200 dark:border-red-900/50"
                              : log.level === "warn"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50"
                                : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50"
                          }`}
                        >
                          {log.level.toUpperCase()}
                        </span>
                      </div>
                      <div className="px-3 py-2 flex items-center text-sm text-neutral-900 dark:text-neutral-100 min-w-0 group-hover:bg-neutral-50 dark:group-hover:bg-neutral-800/30 overflow-x-auto scrollbar-transparent gap-2 transition-colors">
                        {hasTraceDetails(log) && (
                          <Activity className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                        )}
                        <span
                          title={log.message || log.original}
                          className="font-mono whitespace-nowrap text-xs"
                        >
                          {log.message || log.original}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <LogDetailsSidebar
        selectedLog={selectedLog}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
      />
    </div>
  );
}
