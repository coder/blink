"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldFilter, FieldFilterGroup } from "@blink.so/api";
import { Filter, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface TraceFiltersPanelProps {
  filters: FieldFilterGroup;
  onFiltersChange: (filters: FieldFilterGroup) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  availableFields?: readonly string[];
}

const DEFAULT_TRACE_FILTER_FIELDS = [
  "span.parent_span_id",
  "span.name",
  "span.status_code",
  "span.kind",
  "span.trace_id",
  "span.id",
] as const;

type FilterItem = {
  key: string;
  value: string;
};

// Convert FieldFilterGroup to FilterItem[]
const fromFieldFilterGroup = (filters: FieldFilterGroup): FilterItem[] => {
  return filters.filters
    .map((f) => {
      if (f.type === "eq") {
        return { key: f.key, value: f.value };
      }
      return null;
    })
    .filter((f): f is FilterItem => f !== null);
};

// Convert FilterItem[] to FieldFilterGroup
const toFieldFilterGroup = (items: FilterItem[]): FieldFilterGroup => {
  return {
    type: "and",
    filters: items
      .filter((f) => f.key !== "")
      .map(
        (f): FieldFilter => ({
          type: "eq",
          key: f.key,
          value: f.value,
        })
      ),
  };
};

export function TraceFiltersPanel({
  filters,
  onFiltersChange,
  isExpanded,
  onToggleExpanded,
}: TraceFiltersPanelProps) {
  const activeFiltersCount = toFieldFilterGroup(fromFieldFilterGroup(filters))
    .filters.length;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggleExpanded}
      className="gap-2"
    >
      <Filter className="h-4 w-4" />
      Filters
      <span className="ml-1 rounded bg-neutral-200 dark:bg-neutral-700 px-1.5 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">
        {activeFiltersCount}
      </span>
    </Button>
  );
}

export function TraceFiltersContent({
  filters,
  onFiltersChange,
  availableFields = DEFAULT_TRACE_FILTER_FIELDS,
}: Omit<TraceFiltersPanelProps, "isExpanded" | "onToggleExpanded">) {
  const FILTER_FIELDS = availableFields;

  // Internal state: work with FilterItem[] instead of FieldFilterGroup
  const [filterItems, setFilterItems] = useState<FilterItem[]>(() => {
    const items = fromFieldFilterGroup(filters);
    return items.length === 0 ? [{ key: "", value: "" }] : items;
  });

  // Track when we're updating to avoid sync loops
  const isUpdatingRef = useRef(false);

  // Sync with external filters prop when it changes (but not when we changed it)
  useEffect(() => {
    if (isUpdatingRef.current) {
      isUpdatingRef.current = false;
      return;
    }
    const items = fromFieldFilterGroup(filters);
    setFilterItems(items.length === 0 ? [{ key: "", value: "" }] : items);
  }, [filters]);

  // Update both internal state and notify parent
  const updateFilters = (items: FilterItem[]) => {
    isUpdatingRef.current = true;
    setFilterItems(items);
    onFiltersChange(toFieldFilterGroup(items));
  };

  const handleAddFilter = () => {
    const newItem: FilterItem = {
      key: FILTER_FIELDS[0] || "",
      value: "",
    };
    updateFilters([...filterItems, newItem]);
  };

  const handleRemoveFilter = (index: number) => {
    updateFilters(filterItems.filter((_, i) => i !== index));
  };

  const handleUpdateFilter = (index: number, updates: Partial<FilterItem>) => {
    updateFilters(
      filterItems.map((item, i) =>
        i === index ? { ...item, ...updates } : item
      )
    );
  };

  const handleClearAll = () => {
    updateFilters([]);
  };

  const isCustomPath = (key: string) => {
    return !FILTER_FIELDS.includes(key as any);
  };

  const handleToggleCustom = (index: number) => {
    const item = filterItems[index];
    const newKey = isCustomPath(item.key) ? FILTER_FIELDS[0] : "";
    handleUpdateFilter(index, { key: newKey });
  };

  const activeFiltersCount = filterItems.filter((f) => f.key !== "").length;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/30 p-4">
      <div className="flex flex-col gap-4">
        {filterItems.length > 0 && (
          <div className="flex flex-col gap-2">
            {filterItems.map((item, index) => {
              const isCustom = isCustomPath(item.key);
              return (
                <div key={index} className="flex items-center gap-2">
                  {isCustom ? (
                    <Input
                      value={item.key}
                      onChange={(e) =>
                        handleUpdateFilter(index, { key: e.target.value })
                      }
                      placeholder="custom.path"
                      className="w-[200px]"
                    />
                  ) : (
                    <select
                      value={item.key}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "__custom__") {
                          handleUpdateFilter(index, { key: "" });
                        } else {
                          handleUpdateFilter(index, { key: value });
                        }
                      }}
                      className="w-[200px] h-9 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {FILTER_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {field}
                        </option>
                      ))}
                      <option value="__custom__">Custom...</option>
                    </select>
                  )}
                  {isCustom && FILTER_FIELDS.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleCustom(index)}
                      className="px-2"
                      title="Switch to preset"
                    >
                      ↩
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">equals</span>
                  <Input
                    value={item.value}
                    onChange={(e) =>
                      handleUpdateFilter(index, { value: e.target.value })
                    }
                    placeholder="Empty string"
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFilter(index)}
                    className="px-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAddFilter}>
            <Plus className="h-4 w-4 mr-1" />
            Add filter
          </Button>
          {filterItems.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearAll}>
              Clear all
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
