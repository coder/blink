"use client";

import { Button } from "@/components/ui/button";
import type { FieldFilterGroup, OtelSpan } from "@blink.so/api";
import Client from "@blink.so/api";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type DateRange,
  DateRangeFilter,
  getDateRangeValues,
} from "../components/date-range-filter";
import {
  type AgentLog,
  type LogEntry,
  SpanDetailsSidebar,
  tryParseJSON,
} from "./span-details-sidebar";
import { SpanStatusBadge } from "./status-badges";
import { TraceFiltersContent, TraceFiltersPanel } from "./trace-filters-panel";
import { TraceTreeView } from "./trace-tree-view";
import { addMs, formatTimestamp, getTimezoneDisplay } from "./utils";

const client = new Client();

const TRACE_FILTER_FIELDS = [
  "span.parent_span_id",
  "span.name",
  "span.status_code",
  "span.kind",
  "span.trace_id",
  "span.id",
] as const;

interface TracesListProps {
  agentId: string;
  initialFilters?: FieldFilterGroup;
  initialStartTime?: Date;
  initialEndTime?: Date;
}

export default function TracesList({
  agentId,
  initialFilters,
  initialStartTime,
  initialEndTime,
}: TracesListProps) {
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

  const [filters, setFilters] = useState<FieldFilterGroup>(
    initialFilters || {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.parent_span_id",
          value: "",
        },
      ],
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

  const [limit, setLimit] = useState(100);
  const [spans, setSpans] = useState<OtelSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sidebar state (for list view only)
  const [selectedSpan, setSelectedSpan] = useState<OtelSpan | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Logs state (for list view only)
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  // Tree view state
  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const handleDateRangeChange = (newDateRange: DateRange) => {
    setDateRange(newDateRange);
  };

  const handleFiltersChange = (newFilters: FieldFilterGroup) => {
    setFilters(newFilters);
  };

  // Fetch spans
  const fetchSpans = useCallback(async () => {
    if (!agentId) return;

    setLoading(true);
    try {
      const { from: fromDate, to: toDate } = getDateRangeValues(dateRange);

      const data = await client.agents.traces.spans({
        agent_id: agentId,
        start_time: fromDate,
        end_time: toDate,
        filters: stableFilters,
        limit,
      });

      setSpans(data.traces || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching spans:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch spans");
      setSpans([]);
    } finally {
      setLoading(false);
    }
  }, [agentId, dateRange, stableFilters, limit]);

  // Load spans when filters change with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSpans();
    }, 500);

    return () => clearTimeout(timer);
  }, [fetchSpans]);

  // Fetch logs when span is selected
  useEffect(() => {
    if (!selectedSpan || !sidebarOpen) {
      setLogs([]);
      setLogsError(null);
      return;
    }

    const fetchLogs = async () => {
      setLogsLoading(true);
      setLogsError(null);
      try {
        const span = selectedSpan.payload.span;
        const startTime = new Date(selectedSpan.start_time + "Z");
        const endTime = new Date(selectedSpan.end_time + "Z");

        // Fetch logs filtered by trace_id
        const response = await client.agents.logs.logs({
          agent_id: agentId,
          start_time: startTime,
          end_time: endTime,
          filters: {
            type: "and",
            filters: [
              {
                type: "eq",
                key: "trace_id",
                value: span.trace_id,
              },
            ],
          },
          limit: 1000,
        });

        // Process logs and filter by span_id
        const processedLogs: LogEntry[] = response.logs
          .map((log: AgentLog) => {
            const parseResult = tryParseJSON(log.message);
            const entry: LogEntry = {
              ...log,
              original: log.message,
              type: parseResult.isJSON ? "json" : "text",
              parsed: parseResult.isJSON ? parseResult.data : undefined,
            };
            return entry;
          })
          .filter((log: LogEntry) => {
            // Only include logs that have a span_id field matching this span
            if (
              log.type === "json" &&
              log.parsed &&
              typeof log.parsed === "object"
            ) {
              const parsed = log.parsed as Record<string, any>;
              if ("span_id" in parsed) {
                return parsed.span_id === span.id;
              }
            }
            // Logs without span_id are not included
            return false;
          });

        setLogs(processedLogs);
      } catch (err) {
        console.error("Error fetching logs:", err);
        setLogsError(
          err instanceof Error ? err.message : "Failed to fetch logs"
        );
        setLogs([]);
      } finally {
        setLogsLoading(false);
      }
    };

    fetchLogs();
  }, [selectedSpan, sidebarOpen, agentId]);

  const handleReload = () => {
    fetchSpans();
  };

  const handleSpanClick = (span: OtelSpan) => {
    const traceId = span.payload.span.trace_id;
    setSelectedTraceId(traceId);
    setViewMode("tree");
  };

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
    setSelectedSpan(null);
  };

  const handleBackToList = () => {
    setViewMode("list");
    setSelectedTraceId(null);
  };

  return (
    <div className="flex flex-col max-h-full min-h-full relative">
      {viewMode === "tree" && selectedTraceId ? (
        <TraceTreeView
          traceId={selectedTraceId}
          agentId={agentId}
          // to be sure we find all the spans, search 1 hour before and after
          startTime={addMs(getDateRangeValues(dateRange).from, -1000 * 60 * 60)}
          endTime={addMs(getDateRangeValues(dateRange).to, 1000 * 60 * 60)}
          onBack={handleBackToList}
        />
      ) : (
        <div className="flex flex-col p-6 space-y-6 flex-1 max-h-full overflow-y-scroll">
          {/* Filter and Search Row */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 justify-between">
              <div className="flex items-center gap-2">
                <TraceFiltersPanel
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  isExpanded={filtersExpanded}
                  onToggleExpanded={() => setFiltersExpanded(!filtersExpanded)}
                  availableFields={TRACE_FILTER_FIELDS}
                />
                <button
                  onClick={() => setFiltersExpanded(!filtersExpanded)}
                  className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  {filtersExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <DateRangeFilter
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReload}
                  className="px-2"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {filtersExpanded && (
              <TraceFiltersContent
                filters={filters}
                onFiltersChange={handleFiltersChange}
                availableFields={TRACE_FILTER_FIELDS}
              />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-700 rounded-lg flex flex-col min-h-0">
            {error ? (
              <div className="flex flex-col flex-1 items-center justify-center">
                <div className="p-8 text-center">
                  <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
                  <h2 className="text-xl font-medium text-red-700 dark:text-red-300 mb-2">
                    Error Loading Spans
                  </h2>
                  <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                  <Button onClick={handleReload} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Try Again
                  </Button>
                </div>
              </div>
            ) : loading ? (
              <div className="flex-1 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-scroll">
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: "auto auto 1fr auto auto",
                    }}
                  >
                    {/* Table Header */}
                    <div className="contents">
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-transparent border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Time ({getTimezoneDisplay()})
                      </div>
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-transparent border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Span Name
                      </div>
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-transparent border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Trace ID
                      </div>
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-transparent border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Status
                      </div>
                    </div>
                    {/* Skeleton Rows */}
                    {Array.from({ length: 20 }).map((_, index) => (
                      <div
                        key={index}
                        className="col-span-5 p-3 border-l-4 border-transparent"
                      >
                        <div
                          className="h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse"
                          style={{ width: "100%" }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : spans.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-2xl mx-auto p-8">
                  <h2 className="text-xl font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    No Spans Found
                  </h2>
                  <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                    No spans found for the selected filters. Try adjusting your
                    date range or filters.
                  </p>
                  <div className="text-sm text-neutral-400 dark:text-neutral-500">
                    Searching spans from{" "}
                    <span className="font-medium">
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
                    <span className="font-medium">
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
                </div>
              </div>
            ) : (
              <div className="flex-1 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-scroll">
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: "auto auto auto 1fr",
                    }}
                  >
                    {/* Table Header */}
                    <div className="contents">
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Time ({getTimezoneDisplay()})
                      </div>
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Span Name
                      </div>
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Trace ID
                      </div>
                      <div className="sticky top-0 p-3 flex items-center bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 z-10">
                        Status
                      </div>
                    </div>
                    {/* Table Body */}
                    {spans.map((span, index) => (
                      <div
                        key={index}
                        className="contents group cursor-pointer"
                        onClick={() => handleSpanClick(span)}
                      >
                        <div className="p-3 flex items-center text-xs text-neutral-500 dark:text-neutral-400 font-mono whitespace-nowrap group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50 border-l-4 border-transparent group-hover:border-blue-500">
                          {formatTimestamp(span.start_time)}
                        </div>
                        <div className="p-3 flex items-center text-xs text-neutral-900 dark:text-neutral-100 font-mono min-w-0 group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50">
                          <span
                            title={span.payload.span.name}
                            className="truncate"
                          >
                            {span.payload.span.name}
                          </span>
                        </div>
                        <div className="p-3 flex items-center text-xs text-neutral-600 dark:text-neutral-400 font-mono group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50">
                          {span.payload.span.trace_id}
                        </div>
                        <div className="p-3 flex items-center whitespace-nowrap group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50">
                          <SpanStatusBadge
                            statusCode={span.payload.span.status_code}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <SpanDetailsSidebar
        selectedSpan={selectedSpan}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        agentId={agentId}
        logs={logs}
        logsLoading={logsLoading}
        logsError={logsError}
      />
    </div>
  );
}
