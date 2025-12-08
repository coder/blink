import type { FieldFilterGroup } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TraceFiltersContent, TraceFiltersPanel } from "./trace-filters-panel";

const meta: Meta<typeof TraceFiltersPanel> = {
  title: "Components/TraceFiltersPanel",
  component: (props) => {
    const [filters, setFilters] = useState<FieldFilterGroup>(props.filters);
    const [isExpanded, setIsExpanded] = useState(true);

    return (
      <div className="p-6">
        <TraceFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          isExpanded={isExpanded}
          onToggleExpanded={() => {
            setIsExpanded((prev) => !prev);
          }}
        />
        {isExpanded && (
          <div className="mt-4">
            <TraceFiltersContent
              filters={filters}
              onFiltersChange={setFilters}
            />
          </div>
        )}
        <div className="mt-6 p-4 bg-neutral-50 dark:bg-neutral-800 rounded border">
          <h3 className="text-sm font-medium mb-2">Current Filters (JSON):</h3>
          <pre className="text-xs overflow-auto">
            {JSON.stringify(filters, null, 2)}
          </pre>
        </div>
      </div>
    );
  },
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    filters: {
      type: "and",
      filters: [],
    },
  },
};

export const SingleFilter: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.name",
          value: "process_request",
        },
      ],
    },
  },
};

export const MultipleFilters: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.name",
          value: "handle_chat_request",
        },
        {
          type: "eq",
          key: "span.status_code",
          value: "ERROR",
        },
        {
          type: "eq",
          key: "span.kind",
          value: "SERVER",
        },
      ],
    },
  },
};

export const RootSpansOnly: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.parent_span_id",
          value: "",
        },
      ],
    },
  },
};

export const FilteringByTraceId: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.trace_id",
          value: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
        },
      ],
    },
  },
};

export const ErrorSpansFilter: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.parent_span_id",
          value: "",
        },
        {
          type: "eq",
          key: "span.status_code",
          value: "ERROR",
        },
      ],
    },
  },
};

export const ServerSpansOnly: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.kind",
          value: "SERVER",
        },
      ],
    },
  },
};

export const ComplexFiltering: Story = {
  args: {
    filters: {
      type: "and",
      filters: [
        {
          type: "eq",
          key: "span.parent_span_id",
          value: "",
        },
        {
          type: "eq",
          key: "span.status_code",
          value: "OK",
        },
        {
          type: "eq",
          key: "span.kind",
          value: "SERVER",
        },
        {
          type: "eq",
          key: "span.name",
          value: "handle_request",
        },
      ],
    },
  },
};
