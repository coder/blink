"use client";

import { Button } from "@/components/ui/button";
import type { OtelSpan } from "@blink.so/api";
import Client from "@blink.so/api";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  type AgentLog,
  type LogEntry,
  SpanDetailsSidebar,
  tryParseJSON,
} from "./span-details-sidebar";
import { formatDuration, formatTimestamp, getTimezoneDisplay } from "./utils";

const client = new Client();

interface TraceTreeViewProps {
  traceId: string;
  agentId: string;
  startTime: Date;
  endTime: Date;
  onBack: () => void;
}

interface TreeNode {
  span: OtelSpan;
  children: TreeNode[];
}

// Helper function to parse timestamp string to milliseconds
const parseTimestamp = (dateString: string): number => {
  const suffix = dateString.endsWith("Z") ? "" : "Z";
  return new Date(dateString + suffix).getTime();
};

// Calculate trace time window
const calculateTraceTimeWindow = (spans: OtelSpan[]) => {
  if (spans.length === 0) {
    return { minStartTime: 0, maxEndTime: 0, totalDuration: 0 };
  }

  let minStartTime = Infinity;
  let maxEndTime = -Infinity;

  spans.forEach((span) => {
    const startTime = parseTimestamp(span.start_time);
    const durationMs =
      Number(BigInt(span.payload.span.duration_ns)) / 1_000_000;
    const endTime = startTime + durationMs;

    minStartTime = Math.min(minStartTime, startTime);
    maxEndTime = Math.max(maxEndTime, endTime);
  });

  return {
    minStartTime,
    maxEndTime,
    totalDuration: maxEndTime - minStartTime,
  };
};

// Build tree structure from flat span list
const buildTree = (spans: OtelSpan[]): TreeNode[] => {
  const spanMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes for all spans
  spans.forEach((span) => {
    spanMap.set(span.payload.span.id, {
      span,
      children: [],
    });
  });

  // Build parent-child relationships
  spans.forEach((span) => {
    const node = spanMap.get(span.payload.span.id);
    if (!node) return;

    const parentId = span.payload.span.parent_span_id;
    if (!parentId || parentId === "") {
      roots.push(node);
    } else {
      const parent = spanMap.get(parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not found, treat as root
        roots.push(node);
      }
    }
  });

  return roots;
};

interface TreeNodeComponentProps {
  node: TreeNode;
  depth: number;
  expandedIds: Set<string>;
  onToggleExpand: (spanId: string) => void;
  onSpanClick: (span: OtelSpan) => void;
  selectedSpanId: string | null;
  totalDuration: number;
  minStartTime: number;
  logCounts: Map<string, number>;
}

function TreeNodeComponent({
  node,
  depth,
  expandedIds,
  onToggleExpand,
  onSpanClick,
  selectedSpanId,
  totalDuration,
  minStartTime,
  logCounts,
}: TreeNodeComponentProps) {
  const { span, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(span.payload.span.id);
  const isSelected = selectedSpanId === span.payload.span.id;
  const logCount = logCounts.get(span.payload.span.id) || 0;

  const spanStartTime = parseTimestamp(span.start_time);
  const durationMs = Number(BigInt(span.payload.span.duration_ns)) / 1_000_000;

  // Calculate position relative to trace start
  const offsetMs = spanStartTime - minStartTime;
  const barOffsetPercent =
    totalDuration > 0 ? (offsetMs / totalDuration) * 100 : 0;
  const barWidthPercent =
    totalDuration > 0 ? (durationMs / totalDuration) * 100 : 0;

  return (
    <>
      <div
        className={`contents group cursor-pointer ${
          isSelected ? "selected" : ""
        }`}
        onClick={() => onSpanClick(span)}
      >
        {/* Name column */}
        <div
          className={`flex items-center gap-2 py-2 pl-3 border-l-2 group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50 ${
            isSelected
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-transparent"
          }`}
        >
          {/* Indentation spacer */}
          <div className="flex-shrink-0" style={{ width: `${depth * 24}px` }} />
          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(span.payload.span.id);
                }}
                className="hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : null}
          </div>
          <div
            className={`flex-shrink-0 w-2 h-2 rounded-full ${
              span.payload.span.status_code === "ERROR"
                ? "bg-red-500"
                : span.payload.span.status_code === "OK"
                  ? "bg-green-500"
                  : "bg-neutral-400"
            }`}
          />
          <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
            {span.payload.span.name}
          </div>
          {logCount > 0 && (
            <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300">
              {logCount}
            </span>
          )}
        </div>

        {/* Duration bar column */}
        <div
          className={`flex items-center py-2 px-3 group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50 ${
            isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""
          }`}
        >
          <div className="relative flex-1 h-2 bg-neutral-100 dark:bg-neutral-700/30 rounded-sm">
            <div
              className="absolute h-full bg-blue-400 dark:bg-blue-500/60 rounded-sm"
              style={{
                left: `${barOffsetPercent}%`,
                width: `${barWidthPercent}%`,
              }}
            />
          </div>
        </div>

        {/* Duration text column */}
        <div
          className={`flex items-center justify-end py-2 px-3 group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800/50 ${
            isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""
          }`}
        >
          <div className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
            {formatDuration(span.payload.span.duration_ns)}
          </div>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <>
          {children.map((child) => (
            <TreeNodeComponent
              key={child.span.payload.span.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSpanClick={onSpanClick}
              selectedSpanId={selectedSpanId}
              totalDuration={totalDuration}
              minStartTime={minStartTime}
              logCounts={logCounts}
            />
          ))}
        </>
      )}
    </>
  );
}

export function TraceTreeView({
  traceId,
  agentId,
  startTime,
  endTime,
  onBack,
}: TraceTreeViewProps) {
  const params = useParams();
  const organization = params.organization as string;
  const agent = params.agent as string;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [spans, setSpans] = useState<OtelSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sidebar state
  const [selectedSpan, setSelectedSpan] = useState<OtelSpan | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Logs state - cached for the entire trace
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  // Build URL for Related Logs
  const relatedLogsUrl = useMemo(() => {
    const filters = {
      type: "and",
      filters: [{ type: "eq", key: "trace_id", value: traceId }],
    };
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });
    return `/${organization}/${agent}/logs?${params.toString()}`;
  }, [traceId, startTime, endTime, organization, agent]);

  const tree = useMemo(() => buildTree(spans), [spans]);
  const timeWindow = useMemo(() => calculateTraceTimeWindow(spans), [spans]);

  // Fetch spans and logs when trace changes
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setLogsLoading(true);
      setError(null);
      setLogsError(null);

      // Fetch spans and logs in parallel
      const results = await Promise.allSettled([
        client.agents.traces.spans({
          agent_id: agentId,
          start_time: startTime,
          end_time: endTime,
          filters: {
            type: "and",
            filters: [
              {
                type: "eq",
                key: "span.trace_id",
                value: traceId,
              },
            ],
          },
          limit: 1000,
        }),
        client.agents.logs.logs({
          agent_id: agentId,
          start_time: startTime,
          end_time: endTime,
          filters: {
            type: "and",
            filters: [
              {
                type: "eq",
                key: "trace_id",
                value: traceId,
              },
            ],
          },
          limit: 1000,
        }),
      ]);

      // Handle spans result
      const spansResult = results[0];
      if (spansResult.status === "fulfilled") {
        setSpans(spansResult.value.traces || []);
      } else {
        console.error("Error fetching trace spans:", spansResult.reason);
        setError(
          spansResult.reason instanceof Error
            ? spansResult.reason.message
            : "Failed to fetch trace spans"
        );
        setSpans([]);
      }

      // Handle logs result
      const logsResult = results[1];
      if (logsResult.status === "fulfilled") {
        // Process all logs once
        const processedLogs: LogEntry[] = logsResult.value.logs.map(
          (log: AgentLog) => {
            const parseResult = tryParseJSON(log.message);
            const entry: LogEntry = {
              ...log,
              original: log.message,
              type: parseResult.isJSON ? "json" : "text",
              parsed: parseResult.isJSON ? parseResult.data : undefined,
            };
            return entry;
          }
        );
        setAllLogs(processedLogs);
      } else {
        console.error("Error fetching logs:", logsResult.reason);
        setLogsError(
          logsResult.reason instanceof Error
            ? logsResult.reason.message
            : "Failed to fetch logs"
        );
        setAllLogs([]);
      }

      setLoading(false);
      setLogsLoading(false);
    };

    fetchData();
  }, [traceId, agentId, startTime, endTime]);

  // Expand all spans when trace changes
  useEffect(() => {
    setExpandedIds(new Set(spans.map((s) => s.payload.span.id)));
  }, [spans]);

  // Count logs per span
  const logCounts = useMemo(() => {
    const counts = new Map<string, number>();
    allLogs.forEach((log: LogEntry) => {
      if (log.type === "json" && log.parsed && typeof log.parsed === "object") {
        const parsed = log.parsed as Record<string, any>;
        if ("span_id" in parsed) {
          const spanId = parsed.span_id;
          counts.set(spanId, (counts.get(spanId) || 0) + 1);
        }
      }
    });
    return counts;
  }, [allLogs]);

  // Filter logs for the selected span
  const filteredLogs = useMemo(() => {
    if (!selectedSpan) return [];

    const spanId = selectedSpan.payload.span.id;
    return allLogs.filter((log: LogEntry) => {
      // Only include logs that have a span_id field matching this span
      if (log.type === "json" && log.parsed && typeof log.parsed === "object") {
        const parsed = log.parsed as Record<string, any>;
        if ("span_id" in parsed) {
          return parsed.span_id === spanId;
        }
      }
      // Logs without span_id are not included
      return false;
    });
  }, [allLogs, selectedSpan]);

  const handleToggleExpand = (spanId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  };

  const handleSpanClick = (span: OtelSpan) => {
    setSelectedSpan(span);
    setSidebarOpen(true);
  };

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
    setSelectedSpan(null);
  };

  const logsButton = useMemo(() => {
    return (
      <Link href={relatedLogsUrl}>
        <Button variant="outline" size="sm">
          <span className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4" />
            Related Logs
          </span>
        </Button>
      </Link>
    );
  }, [relatedLogsUrl]);

  const backButton = useMemo(() => {
    return (
      <Button variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
    );
  }, [onBack]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 py-6">
          <div className="flex items-center gap-3">
            {backButton}
            <div className="text-sm text-neutral-600 dark:text-neutral-400">
              Trace:{" "}
              <span className="font-mono text-neutral-900 dark:text-neutral-100">
                {traceId}
              </span>
            </div>
            {logsButton}
          </div>
        </div>

        {/* Tree Container with Skeleton */}
        <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-700 rounded-lg m-4 mt-0">
          <div
            className="grid py-2"
            style={{
              gridTemplateColumns: "max-content 1fr auto",
            }}
          >
            {/* Header row (empty) */}
            <div className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 py-2 pl-3 pr-4 flex items-center">
              <span className="text-xs font-medium text-transparent ml-7">
                Span Name
              </span>
            </div>
            <div className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 py-2 px-3 flex items-center justify-between" />
            <div className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 py-2 px-3" />

            <div className="col-span-3 py-[2px]" />

            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="contents">
                {/* Name column */}
                <div className="flex items-center gap-2 py-3 pl-8 border-l-2 border-transparent" />

                {/* Duration bar column */}
                <div className="flex items-center py-3 px-3">
                  <div className="relative flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-sm animate-pulse" />
                </div>

                {/* Duration text column */}
                <div className="flex items-center justify-end py-3 px-5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="p-8 text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-red-700 dark:text-red-300 mb-2">
            Error Loading Trace
          </h2>
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          {backButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between p-4 py-6">
        <div className="flex items-center gap-3">
          {backButton}
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            Trace:{" "}
            <span className="font-mono text-neutral-900 dark:text-neutral-100">
              {traceId}
            </span>
          </div>
          {logsButton}
          <div className="flex items-center gap-2">
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              {spans.length} spans
            </div>
            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              {formatDuration(
                String(Math.floor(timeWindow.totalDuration * 1_000_000))
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-700 rounded-lg m-4 mt-0">
        {tree.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 dark:text-neutral-400">
            No spans found in this trace
          </div>
        ) : (
          <div
            className="grid py-2"
            style={{
              gridTemplateColumns: "max-content 1fr auto",
            }}
          >
            {/* Timeline Header */}
            {spans.length > 0 &&
              (() => {
                // Find the span with the earliest start time
                const earliestSpan = spans.reduce((earliest, current) =>
                  parseTimestamp(current.start_time) <
                  parseTimestamp(earliest.start_time)
                    ? current
                    : earliest
                );
                // Calculate the latest end time
                const latestEndTime = timeWindow.maxEndTime;
                // Create a formatted timestamp for the end time
                const endTimeString = new Date(latestEndTime)
                  .toISOString()
                  .replace("T", " ")
                  .substring(0, 29);

                const timezone = getTimezoneDisplay();

                return (
                  <>
                    {/* Name column header */}
                    <div className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 py-2 pl-3 pr-4 flex items-center">
                      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400 ml-7">
                        Span Name
                      </span>
                    </div>

                    {/* Timeline labels */}
                    <div className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 py-2 px-3 flex items-center justify-between text-xs font-mono text-neutral-600 dark:text-neutral-400">
                      <span>
                        {formatTimestamp(earliestSpan.start_time)} {timezone}
                      </span>
                      <span>
                        {formatTimestamp(endTimeString)} {timezone}
                      </span>
                    </div>

                    {/* Duration text column header (empty) */}
                    <div className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 py-2 px-3" />
                  </>
                );
              })()}

            {/* Tree rows */}
            {tree.map((node) => (
              <TreeNodeComponent
                key={node.span.payload.span.id}
                node={node}
                depth={0}
                expandedIds={expandedIds}
                onToggleExpand={handleToggleExpand}
                onSpanClick={handleSpanClick}
                selectedSpanId={selectedSpan?.payload.span.id || null}
                totalDuration={timeWindow.totalDuration}
                minStartTime={timeWindow.minStartTime}
                logCounts={logCounts}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <SpanDetailsSidebar
        selectedSpan={selectedSpan}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        agentId={agentId}
        logs={filteredLogs}
        logsLoading={logsLoading}
        logsError={logsError}
      />
    </div>
  );
}
