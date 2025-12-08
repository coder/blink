"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowRight, Calendar, Check, ChevronDown } from "lucide-react";
import React, { useState } from "react";

export type DateRangeOption = {
  id: string;
  label: string;
  value: Date | "now" | "custom";
};

const FROM_OPTIONS: DateRangeOption[] = [
  {
    id: "1h",
    label: "1 hour ago",
    value: new Date(Date.now() - 60 * 60 * 1000),
  },
  {
    id: "24h",
    label: "24 hours ago",
    value: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: "7d",
    label: "7 days ago",
    value: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  },
  {
    id: "custom",
    label: "Custom date/time",
    value: "custom",
  },
];

const TO_OPTIONS: DateRangeOption[] = [
  {
    id: "now",
    label: "Now",
    value: "now",
  },
  {
    id: "custom",
    label: "Custom date/time",
    value: "custom",
  },
];

export type DateRange = {
  from: DateRangeOption;
  fromCustom?: Date;
  to: DateRangeOption;
  toCustom?: Date;
};

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (dateRange: DateRange) => void;
}

function formatCustomDateTime(date: Date): string {
  return date.toISOString().slice(0, 16); // Format for datetime-local input
}

function parseCustomDateTime(dateTimeString: string): Date {
  return new Date(dateTimeString);
}

function DateRangeDropdown({
  options,
  selected,
  onSelect,
  customValue,
  onCustomChange,
  label,
}: {
  options: DateRangeOption[];
  selected: DateRangeOption;
  onSelect: (option: DateRangeOption) => void;
  customValue?: Date;
  onCustomChange?: (date: Date) => void;
  label: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [customDateTime, setCustomDateTime] = useState(
    customValue
      ? formatCustomDateTime(customValue)
      : formatCustomDateTime(new Date())
  );

  const handleOptionSelect = (option: DateRangeOption) => {
    onSelect(option);
    if (option.id !== "custom") {
      setIsOpen(false);
    }
  };

  const handleCustomDateTimeChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;
    setCustomDateTime(value);
    if (value && onCustomChange) {
      onCustomChange(parseCustomDateTime(value));
    }
  };

  const handleCustomApply = () => {
    if (customDateTime && onCustomChange) {
      onCustomChange(parseCustomDateTime(customDateTime));
    }
    setIsOpen(false);
  };

  const displayLabel = (() => {
    if (selected.id === "custom") {
      if (customValue) {
        // Format the custom date for display
        return `${customValue.toLocaleDateString()} ${customValue.toLocaleTimeString(
          [],
          {
            hour: "2-digit",
            minute: "2-digit",
          }
        )}`;
      }
      return "Custom";
    }
    return selected.label;
  })();

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="justify-between min-w-[160px]"
          size="sm"
        >
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span className="text-sm">{displayLabel}</span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="p-1">
          {options.map((option) => {
            const isSelected = selected.id === option.id;
            return (
              <div key={option.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded-sm hover:bg-accent",
                    isSelected && "bg-accent"
                  )}
                  onClick={() => handleOptionSelect(option)}
                >
                  <div className="flex items-center justify-center w-4 h-4">
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <span>{option.label}</span>
                </div>

                {/* Custom datetime input */}
                {option.id === "custom" && isSelected && (
                  <div className="p-2 border-t border-neutral-200 dark:border-neutral-700 mt-1">
                    <div className="space-y-2">
                      <Input
                        type="datetime-local"
                        value={customDateTime}
                        onChange={handleCustomDateTimeChange}
                        className="text-sm"
                      />
                      <Button
                        onClick={handleCustomApply}
                        size="sm"
                        className="w-full"
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DateRangeFilter({
  dateRange,
  onDateRangeChange,
}: DateRangeFilterProps) {
  const handleFromChange = (fromOption: DateRangeOption) => {
    onDateRangeChange({
      ...dateRange,
      from: fromOption,
    });
  };

  const handleFromCustomChange = (customDate: Date) => {
    onDateRangeChange({
      ...dateRange,
      fromCustom: customDate,
    });
  };

  const handleToChange = (toOption: DateRangeOption) => {
    onDateRangeChange({
      ...dateRange,
      to: toOption,
    });
  };

  const handleToCustomChange = (customDate: Date) => {
    onDateRangeChange({
      ...dateRange,
      toCustom: customDate,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangeDropdown
        options={FROM_OPTIONS}
        selected={dateRange.from}
        onSelect={handleFromChange}
        customValue={dateRange.fromCustom}
        onCustomChange={handleFromCustomChange}
        label=""
      />
      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <DateRangeDropdown
        options={TO_OPTIONS}
        selected={dateRange.to}
        onSelect={handleToChange}
        customValue={dateRange.toCustom}
        onCustomChange={handleToCustomChange}
        label=""
      />
    </div>
  );
}

// Helper function to get the actual date values
export function getDateRangeValues(dateRange: DateRange): {
  from: Date;
  to: Date;
} {
  let fromDate: Date;
  let toDate: Date;

  if (dateRange.from.id === "custom" && dateRange.fromCustom) {
    fromDate = dateRange.fromCustom;
  } else if (dateRange.from.value instanceof Date) {
    fromDate = dateRange.from.value;
  } else {
    fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24 hours ago
  }

  if (dateRange.to.id === "custom" && dateRange.toCustom) {
    toDate = dateRange.toCustom;
  } else if (dateRange.to.value === "now") {
    toDate = new Date();
  } else {
    toDate = new Date(); // Default to now
  }

  return { from: fromDate, to: toDate };
}
