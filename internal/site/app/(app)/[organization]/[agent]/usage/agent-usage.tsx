"use client";

import { PageContainer, PageHeader } from "@/components/page-header";
import { AreaChart } from "@/components/ui/area-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Database, MessageCircle, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { TimeRangeSelector, type TimeRange } from "./time-range-selector";

interface Props {
  agentName: string;
  totalRuntime: number;
  dailyChats: Array<{ interval: string; unique_chats: number }>;
  tokenStats: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cached_tokens: number;
    avg_ttft_ms: number;
    models: string[];
  };
  dailyRuntime: Array<{ interval: string; runtime_seconds: number }>;
  tokenUsageByModel: Array<{
    interval: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
  }>;
  ttftByModel: Array<{
    interval: string;
    model: string;
    avg_ttft_ms: number;
  }>;
  startDate: Date;
  endDate: Date;
  timeRange: TimeRange;
  granularity: "1 hour" | "1 day";
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatDurationWithDays(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

function formatDateForTooltip(
  date: string,
  granularity: "1 hour" | "1 day"
): string {
  const d = new Date(date);
  if (granularity === "1 hour") {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fillDateBuckets<T extends { date: string }>(
  data: T[],
  startDate: Date,
  endDate: Date,
  defaultValues: Omit<T, "date">,
  granularity: "1 hour" | "1 day"
): T[] {
  const result: T[] = [];
  const dataMap = new Map(data.map((d) => [d.date, d]));

  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  // Normalize to start of day for both hourly and daily granularity
  // This ensures consistent bucketing behavior
  end.setHours(0, 0, 0, 0);

  if (granularity === "1 hour") {
    while (current <= end) {
      const dateStr = current.toISOString();
      const existing = dataMap.get(dateStr);

      if (existing) {
        result.push(existing);
      } else {
        result.push({ date: dateStr, ...defaultValues } as T);
      }

      current.setHours(current.getHours() + 1);
    }
  } else {
    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      const existing = dataMap.get(dateStr);

      if (existing) {
        result.push(existing);
      } else {
        result.push({ date: dateStr, ...defaultValues } as T);
      }

      current.setDate(current.getDate() + 1);
    }
  }

  return result;
}

export function AgentUsageClient({
  agentName,
  totalRuntime,
  dailyChats,
  tokenStats,
  dailyRuntime,
  tokenUsageByModel,
  ttftByModel,
  startDate,
  endDate,
  timeRange,
  granularity,
}: Props) {
  const [hoveredRuntime, setHoveredRuntime] = useState<
    { interval: string; runtime_seconds: number } | undefined
  >();

  const [hoveredChats, setHoveredChats] = useState<
    { interval: string; unique_chats: number } | undefined
  >();

  const runtimeChartData = useMemo(() => {
    const data = dailyRuntime.map((d) => ({
      date:
        granularity === "1 day"
          ? new Date(d.interval).toISOString().split("T")[0]
          : new Date(d.interval).toISOString(),
      Runtime: d.runtime_seconds,
    }));

    const filled = fillDateBuckets(
      data,
      startDate,
      endDate,
      { Runtime: 0 },
      granularity
    );

    return filled.map((d) => ({
      date: formatDateForTooltip(d.date, granularity),
      Runtime: d.Runtime,
    }));
  }, [dailyRuntime, startDate, endDate, granularity]);

  const chatsChartData = useMemo(() => {
    const data = dailyChats.map((d) => ({
      date:
        granularity === "1 day"
          ? new Date(d.interval).toISOString().split("T")[0]
          : new Date(d.interval).toISOString(),
      Chats: d.unique_chats,
    }));
    const filled = fillDateBuckets(
      data,
      startDate,
      endDate,
      { Chats: 0 },
      granularity
    );
    return filled.map((d) => ({
      date: formatDateForTooltip(d.date, granularity),
      Chats: d.Chats,
    }));
  }, [dailyChats, startDate, endDate, granularity]);

  const tokenUsageChartData = useMemo(() => {
    const dateTokenTypeMap = new Map<
      string,
      { input: number; output: number; cached: number }
    >();

    tokenUsageByModel.forEach((row) => {
      const date =
        granularity === "1 day"
          ? new Date(row.interval).toISOString().split("T")[0]
          : new Date(row.interval).toISOString();
      if (!dateTokenTypeMap.has(date)) {
        dateTokenTypeMap.set(date, { input: 0, output: 0, cached: 0 });
      }
      const dateData = dateTokenTypeMap.get(date)!;
      dateData.input += row.input_tokens;
      dateData.output += row.output_tokens;
      dateData.cached += row.cached_tokens;
    });

    const result: Array<{
      date: string;
      Input: number;
      Output: number;
      Cached: number;
    }> = [];

    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    if (granularity === "1 hour") {
      while (current <= end) {
        const dateStr = current.toISOString();
        const data = dateTokenTypeMap.get(dateStr) || {
          input: 0,
          output: 0,
          cached: 0,
        };

        result.push({
          date: formatDateForTooltip(dateStr, granularity),
          Input: data.input,
          Output: data.output,
          Cached: data.cached,
        });

        current.setHours(current.getHours() + 1);
      }
    } else {
      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const data = dateTokenTypeMap.get(dateStr) || {
          input: 0,
          output: 0,
          cached: 0,
        };

        result.push({
          date: formatDateForTooltip(dateStr, granularity),
          Input: data.input,
          Output: data.output,
          Cached: data.cached,
        });

        current.setDate(current.getDate() + 1);
      }
    }

    return result;
  }, [tokenUsageByModel, startDate, endDate, granularity]);

  const ttftChartData = useMemo(() => {
    const dateModelMap = new Map<string, Record<string, number>>();

    ttftByModel.forEach((row) => {
      const date =
        granularity === "1 day"
          ? new Date(row.interval).toISOString().split("T")[0]
          : new Date(row.interval).toISOString();
      if (!dateModelMap.has(date)) {
        dateModelMap.set(date, {});
      }
      const dateData = dateModelMap.get(date)!;
      dateData[row.model] = row.avg_ttft_ms;
    });

    const models = Array.from(new Set(ttftByModel.map((row) => row.model)));
    const result: Array<{ date: string; [key: string]: string | number }> = [];

    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    if (granularity === "1 hour") {
      while (current <= end) {
        const dateStr = current.toISOString();
        const row: { date: string; [key: string]: string | number } = {
          date: formatDateForTooltip(dateStr, granularity),
        };

        models.forEach((model) => {
          row[model] = dateModelMap.get(dateStr)?.[model] || 0;
        });

        result.push(row);
        current.setHours(current.getHours() + 1);
      }
    } else {
      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const row: { date: string; [key: string]: string | number } = {
          date: formatDateForTooltip(dateStr, granularity),
        };

        models.forEach((model) => {
          row[model] = dateModelMap.get(dateStr)?.[model] || 0;
        });

        result.push(row);
        current.setDate(current.getDate() + 1);
      }
    }

    return { data: result, models };
  }, [ttftByModel, startDate, endDate, granularity]);

  const displayRuntimeValue = useMemo(() => {
    if (hoveredRuntime) {
      return hoveredRuntime.runtime_seconds;
    }
    if (dailyRuntime.length) {
      return dailyRuntime[dailyRuntime.length - 1]?.runtime_seconds || 0;
    }
    return 0;
  }, [hoveredRuntime, dailyRuntime]);

  const displayRuntimeLabel = useMemo(() => {
    if (hoveredRuntime) {
      return new Date(hoveredRuntime.interval).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
    return "Daily Runtime";
  }, [hoveredRuntime]);

  const displayChatsValue = useMemo(() => {
    if (hoveredChats) {
      return hoveredChats.unique_chats;
    }
    if (dailyChats.length) {
      return dailyChats[dailyChats.length - 1]?.unique_chats || 0;
    }
    return 0;
  }, [hoveredChats, dailyChats]);

  const displayChatsLabel = useMemo(() => {
    if (hoveredChats) {
      return new Date(hoveredChats.interval).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
    return "Daily Chats";
  }, [hoveredChats]);

  const totalChats = useMemo(() => {
    return dailyChats.reduce((sum, d) => sum + d.unique_chats, 0);
  }, [dailyChats]);

  const timeRangeLabel =
    timeRange === "24h"
      ? "24 hours"
      : timeRange === "7d"
        ? "7 days"
        : "30 days";

  return (
    <PageContainer>
      <div className="flex items-start justify-between">
        <PageHeader
          title="Usage"
          description={`Real-time metrics for ${agentName} over the last ${timeRangeLabel}`}
        />
        <TimeRangeSelector />
      </div>

      {/* Key Metrics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Runtime
            </CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {formatDurationWithDays(totalRuntime)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Agent uptime (managing chats, webhooks)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Chats
            </CardTitle>
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {formatNumber(totalChats)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tokens Processed
            </CardTitle>
            <Database className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {formatNumber(
                tokenStats.total_input_tokens + tokenStats.total_output_tokens
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              +{formatNumber(tokenStats.total_cached_tokens)} cached
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Time-to-First-Token
            </CardTitle>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {tokenStats.avg_ttft_ms > 0
                ? `${Math.round(tokenStats.avg_ttft_ms)}ms`
                : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average across all models
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid - 2x2 Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Runtime Chart */}
        {runtimeChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Daily Runtime</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Agent execution time per day
              </p>
            </CardHeader>
            <CardContent>
              <AreaChart
                className="h-64"
                data={runtimeChartData}
                index="date"
                categories={["Runtime"]}
                colors={["blue"]}
                valueFormatter={(v) => formatDuration(v as number)}
                showLegend={false}
              />
            </CardContent>
          </Card>
        )}

        {/* Conversations Chart */}
        {chatsChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Daily Chats</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Unique conversations initiated per day
              </p>
            </CardHeader>
            <CardContent>
              <AreaChart
                className="h-64"
                data={chatsChartData}
                index="date"
                categories={["Chats"]}
                colors={["emerald"]}
                valueFormatter={(v) => formatNumber(v as number)}
                showLegend={false}
              />
            </CardContent>
          </Card>
        )}

        {/* Token Usage Chart */}
        {tokenUsageChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Token Usage Over Time</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Daily token consumption by type
              </p>
            </CardHeader>
            <CardContent>
              <AreaChart
                className="h-64"
                data={tokenUsageChartData}
                index="date"
                categories={["Input", "Output", "Cached"]}
                colors={["blue", "violet", "amber"]}
                valueFormatter={(v) => formatNumber(v as number)}
                showLegend={true}
                connectNulls={false}
              />
              <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <div className="text-sm">
                    <span className="font-medium">
                      {formatNumber(tokenStats.total_input_tokens)}
                    </span>
                    <span className="text-muted-foreground ml-1">
                      input tokens
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-violet-500" />
                  <div className="text-sm">
                    <span className="font-medium">
                      {formatNumber(tokenStats.total_output_tokens)}
                    </span>
                    <span className="text-muted-foreground ml-1">
                      output tokens
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <div className="text-sm">
                    <span className="font-medium">
                      {formatNumber(tokenStats.total_cached_tokens)}
                    </span>
                    <span className="text-muted-foreground ml-1">
                      cached tokens
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Time to First Token Chart */}
        {ttftChartData.models.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Response Time by Model</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Average time to first token across different models
              </p>
            </CardHeader>
            <CardContent>
              <AreaChart
                className="h-64"
                data={ttftChartData.data}
                index="date"
                categories={ttftChartData.models}
                colors={["blue", "emerald", "violet", "amber", "pink"]}
                valueFormatter={(v) => `${Math.round(v as number)}ms`}
                showLegend={true}
                connectNulls={false}
              />
              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
                <span className="text-sm text-muted-foreground">Models:</span>
                {tokenStats.models.map((model) => (
                  <Badge key={model} variant="secondary">
                    {model}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
