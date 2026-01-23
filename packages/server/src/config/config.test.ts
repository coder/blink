import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveOptions } from "./cli-parser";
import { CLI_OPTION_DEFINITIONS } from "./config";

const ENV_KEYS = Object.values(CLI_OPTION_DEFINITIONS).map((spec) => spec.env);

const clearBlinkEnv = (): (() => void) => {
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

let restoreEnv: (() => void) | undefined;

beforeEach(() => {
  restoreEnv = clearBlinkEnv();
});

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
});

describe("resolveOptions", () => {
  test("uses default port when BLINK_PORT is unset", () => {
    const options = resolveOptions({});
    expect(options.port).toBe(3005);
  });
});
