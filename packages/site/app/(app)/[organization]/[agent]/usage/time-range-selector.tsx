"use client";

import { Badge } from "@/components/ui/badge";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type TimeRange = "24h" | "7d" | "30d";

export function TimeRangeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentRange = (searchParams.get("range") as TimeRange) || "30d";

  const ranges: { value: TimeRange; label: string }[] = [
    { value: "24h", label: "24 hours" },
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
  ];

  const handleRangeChange = (range: TimeRange) => {
    const params = new URLSearchParams(searchParams);
    params.set("range", range);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex gap-2 items-center">
      {ranges.map((range) => (
        <Badge
          key={range.value}
          variant={currentRange === range.value ? "default" : "secondary"}
          className="cursor-pointer"
          onClick={() => handleRangeChange(range.value)}
        >
          {range.label}
        </Badge>
      ))}
    </div>
  );
}
