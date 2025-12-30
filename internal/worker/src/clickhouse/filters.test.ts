import type { FieldFilterGroup } from "@blink.so/api";
import { describe, expect, test } from "bun:test";
import { compileFilters } from "./filters";

describe("compileFilters", () => {
  test("should compile a single filter", () => {
    const filters = {
      type: "and",
      filters: [{ type: "eq", key: "testKey", value: "testValue" }],
    } satisfies FieldFilterGroup;
    const result = compileFilters(filters);
    expect(result.query).toBe(
      "(JSON_VALUE(payload_str, {k0: String}) = {v0: String})"
    );
    expect(result.params).toEqual({
      k0: "$.testKey",
      v0: "testValue",
    });
  });

  test("should compile a group of filters", () => {
    const filters = {
      type: "and",
      filters: [
        { type: "eq", key: "testKey", value: "testValue" },
        { type: "eq", key: "testKey2", value: "testValue2" },
      ],
    } satisfies FieldFilterGroup;
    const result = compileFilters(filters);
    expect(result.query).toBe(
      "(JSON_VALUE(payload_str, {k0: String}) = {v0: String} AND JSON_VALUE(payload_str, {k1: String}) = {v1: String})"
    );
    expect(result.params).toEqual({
      k0: "$.testKey",
      v0: "testValue",
      k1: "$.testKey2",
      v1: "testValue2",
    });
  });

  test("should compile a nested group of filters", () => {
    const filters = {
      type: "and",
      filters: [
        { type: "eq", key: "testKey", value: "testValue" },
        {
          type: "and",
          filters: [
            { type: "eq", key: "testKey2", value: "testValue2" },
            { type: "eq", key: "testKey3", value: "testValue3" },
          ],
        },
      ],
    } satisfies FieldFilterGroup;
    const result = compileFilters(filters);
    expect(result.query).toBe(
      "(JSON_VALUE(payload_str, {k0: String}) = {v0: String} AND (JSON_VALUE(payload_str, {k1: String}) = {v1: String} AND JSON_VALUE(payload_str, {k2: String}) = {v2: String}))"
    );
    expect(result.params).toEqual({
      k0: "$.testKey",
      v0: "testValue",
      k1: "$.testKey2",
      v1: "testValue2",
      k2: "$.testKey3",
      v2: "testValue3",
    });
  });

  test("should compile a group of filters with no filters", () => {
    const filters = {
      type: "and",
      filters: [],
    } satisfies FieldFilterGroup;
    const result = compileFilters(filters);
    expect(result.query).toBe("(TRUE)");
    expect(result.params).toEqual({});
  });
});
