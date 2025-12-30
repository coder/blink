import type { FieldFilter, FieldFilterGroup } from "@blink.so/api";
import util from "util";

export function compileFilters(filters: FieldFilterGroup | FieldFilter): {
  query: string;
  params: Record<string, string>;
} {
  return compileFiltersInner(filters, { counter: 0, params: {} });
}

function compileFiltersInner(
  filters: FieldFilterGroup | FieldFilter,
  acc: { counter: number; params: Record<string, string> }
): {
  query: string;
  params: Record<string, string>;
} {
  if ("filters" in filters) {
    // we are handling a group of filters
    if (filters.type !== "and") {
      const _exhaustiveCheck: never = filters;
      throw new Error(
        `Invalid filters, expected type and: ${util.inspect(filters)}`
      );
    }
    if (filters.filters.length === 0) {
      return { query: "(TRUE)", params: {} };
    }
    const query =
      "(" +
      filters.filters
        .map((filter) => compileFiltersInner(filter, acc).query)
        .join(" AND ") +
      ")";
    return { query, params: acc.params };
  } else if ("key" in filters && "value" in filters) {
    // we are handling a single filter
    if (filters.type !== "eq") {
      const _exhaustiveCheck: never = filters;
      throw new Error(
        `Invalid filters, expected type eq: ${util.inspect(filters)}`
      );
    }
    const keyParamName = `k${acc.counter}`;
    const valueParamName = `v${acc.counter}`;
    acc.counter++;
    acc.params[keyParamName] = `$.${filters.key}`;
    acc.params[valueParamName] = filters.value;
    // this is not the most efficient way to filter by JSON paths, but it's very simple to implement.
    // the key name is provided by the user, so it's an untrusted input we need to escape.
    // by using JSON_VALUE we can leverage ClickHouse built-in query params to escape the key name.
    // we could improve performance by escaping the key name ourselves and using it as a column name
    // since the `payload` column is of type JSON, which ClickHouse supports natively.
    const query = `JSON_VALUE(payload_str, {${keyParamName}: String}) = {${valueParamName}: String}`;
    return { query, params: acc.params };
  } else {
    const _exhaustiveCheck: never = filters;
    throw new Error(`Invalid filters: ${util.inspect(filters)}`);
  }
}
