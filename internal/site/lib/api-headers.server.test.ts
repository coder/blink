import { afterEach, expect, test } from "bun:test";
import { getAPIHeaders } from "./api-headers.server";

const original = process.env.BLINK_API_HEADERS;
afterEach(() => {
  if (original === undefined) delete process.env.BLINK_API_HEADERS;
  else process.env.BLINK_API_HEADERS = original;
});

test("absent or empty configuration adds no headers", () => {
  delete process.env.BLINK_API_HEADERS;
  expect(getAPIHeaders()).toBeUndefined();
  for (const value of ["", "  \n "]) {
    process.env.BLINK_API_HEADERS = value;
    expect(getAPIHeaders()).toBeUndefined();
  }
});

test("reads and validates the current environment", () => {
  process.env.BLINK_API_HEADERS = '{"X-Gateway":"secret"}';
  expect(getAPIHeaders()).toEqual({ "x-gateway": "secret" });
  process.env.BLINK_API_HEADERS = "{}";
  expect(getAPIHeaders()).toEqual({});
});

test("invalid configuration fails without disclosing credentials", () => {
  for (const value of [
    "secret",
    "null",
    "[]",
    '{"X-Gateway":42}',
    '{"bad name":"secret"}',
    JSON.stringify({ "X-Gateway": "secret\r\ninjected" }),
  ]) {
    process.env.BLINK_API_HEADERS = value;
    expect(getAPIHeaders).toThrow(
      new Error(
        "BLINK_API_HEADERS must be a JSON object of valid HTTP headers with string values"
      )
    );
  }
});
