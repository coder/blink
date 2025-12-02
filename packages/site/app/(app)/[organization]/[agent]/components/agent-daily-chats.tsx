"use client";

import { AreaChart } from "@/components/ui/area-chart";
import { MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";

type AgentDailyChat = {
  interval: string;
  unique_chats: number;
};

export default function AgentDailyChats({ data }: { data: AgentDailyChat[] }) {
  const [hoveredValue, setHoveredValue] = useState<
    | {
        interval: string;
        unique_chats: number;
      }
    | undefined
  >(undefined);

  const displayValue = useMemo(() => {
    if (hoveredValue === undefined) {
      return data[data.length - 1]?.unique_chats ?? 0;
    }
    return hoveredValue.unique_chats;
  }, [hoveredValue, data]);

  const displayText = useMemo(() => {
    if (hoveredValue === undefined) {
      return "Daily Chats";
    }
    return new Date(hoveredValue.interval).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      weekday: "long",
    });
  }, [hoveredValue]);

  return (
    <div className="flex flex-col border-b border-b-2">
      <div className="text-sm font-medium text-muted-foreground flex flex-row items-center gap-1">
        <MessageCircle className="w-4 h-4" />
        {displayText}
      </div>
      <div className="flex flex-row">
        <div className="basis-64 text-xl font-medium mt-auto mb-2">
          {displayValue}
        </div>
        <AreaChart
          className="basis-128 h-[50px]"
          data={data}
          index="interval"
          categories={["unique_chats"]}
          colors={["blue"]}
          showLegend={false}
          showXAxis={false}
          showYAxis={false}
          showGridLines={false}
          showTooltip={false}
          tooltipCallback={(value) => {
            if (!value.payload[0]) {
              setHoveredValue(undefined);
              return;
            }
            setHoveredValue({
              interval: value.payload[0]?.index,
              unique_chats: value.payload[0]?.value,
            });
            return null;
          }}
        />
      </div>
    </div>
  );
}
