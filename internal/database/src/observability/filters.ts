import type { AnyColumn, SQL } from "drizzle-orm";
import { and, sql } from "drizzle-orm";
import util from "util";

export interface FieldFilter {
  type: "eq";
  key: string;
  value: string;
}

export interface FieldFilterGroup {
  type: "and";
  filters: (FieldFilter | FieldFilterGroup)[];
}

/**
 * Compile filters to PostgreSQL SQL expressions.
 * This mirrors the Clickhouse implementation but uses PostgreSQL's JSONB operators.
 */
export function compileFilters(
  filters: FieldFilterGroup | FieldFilter,
  payloadColumn: AnyColumn | SQL
): SQL | undefined {
  return compileFiltersInner(filters, payloadColumn);
}

function compileFiltersInner(
  filters: FieldFilterGroup | FieldFilter,
  payloadColumn: AnyColumn | SQL
): SQL | undefined {
  if ("filters" in filters) {
    // Handle a group of filters
    if (filters.type !== "and") {
      const _exhaustiveCheck: never = filters;
      throw new Error(
        `Invalid filters, expected type and: ${util.inspect(filters)}`
      );
    }
    if (filters.filters.length === 0) {
      return undefined;
    }
    const compiledFilters = filters.filters
      .map((filter) => compileFiltersInner(filter, payloadColumn))
      .filter((f): f is SQL => f !== undefined);

    if (compiledFilters.length === 0) {
      return undefined;
    }
    return and(...compiledFilters);
  } else if ("key" in filters && "value" in filters) {
    // Handle a single filter
    if (filters.type !== "eq") {
      const _exhaustiveCheck: never = filters;
      throw new Error(
        `Invalid filters, expected type eq: ${util.inspect(filters)}`
      );
    }
    // Use PostgreSQL's JSONB path extraction operator #>>
    // This extracts the value at the given JSON path as text
    // For example: payload #>> '{span,name}' = 'value' for key "span.name"
    // Path elements are separated by commas in PostgreSQL's #>> operator
    const jsonPath = `{${filters.key.split(".").join(",")}}`;
    return sql`${payloadColumn} #>> ${jsonPath} = ${filters.value}`;
  } else {
    const _exhaustiveCheck: never = filters;
    throw new Error(`Invalid filters: ${util.inspect(filters)}`);
  }
}
