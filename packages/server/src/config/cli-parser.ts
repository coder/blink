import {
  CLI_OPTION_DEFINITIONS,
  type CliOptionKey,
  getCliEnvValue,
  parseCliOptionValue,
  type ResolvedCliOptions,
} from "./config";

type RawCliOptionValue = string | boolean | undefined;
export type RawCliOptions = Partial<Record<CliOptionKey, RawCliOptionValue>>;

const toStringValue = (value: RawCliOptionValue): string | undefined => {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value;
};

const hasShortFlag = (flags: string): boolean => {
  const firstFlag = flags.split(",")[0]?.trim() ?? "";
  return firstFlag.startsWith("-") && !firstFlag.startsWith("--");
};

export const optionKeys = (
  Object.keys(CLI_OPTION_DEFINITIONS) as CliOptionKey[]
).sort((left, right) => {
  const leftHasShort = hasShortFlag(CLI_OPTION_DEFINITIONS[left].flags);
  const rightHasShort = hasShortFlag(CLI_OPTION_DEFINITIONS[right].flags);
  if (leftHasShort !== rightHasShort) {
    return leftHasShort ? -1 : 1;
  }
  return left.localeCompare(right);
});

export const buildOptionDescription = (spec: {
  description: string;
  env: string;
  defaultValue?: unknown;
}): string => {
  const parts = [spec.description];
  if ("defaultValue" in spec && spec.defaultValue !== undefined) {
    parts.push(`(default: ${spec.defaultValue})`);
  }
  parts.push(`[env: ${spec.env}]`);
  return parts.join(" ");
};

export const resolveOptions = (
  rawOptions: RawCliOptions
): ResolvedCliOptions => {
  const resolved = {} as ResolvedCliOptions;
  for (const key of optionKeys) {
    const cliValue = rawOptions[key];
    if (cliValue !== undefined) {
      (resolved as Record<string, unknown>)[key] = parseCliOptionValue(
        key,
        toStringValue(cliValue),
        "cli"
      );
      continue;
    }
    const envValue = getCliEnvValue(key);
    if (envValue !== undefined) {
      (resolved as Record<string, unknown>)[key] = envValue;
      continue;
    }
    const spec = CLI_OPTION_DEFINITIONS[key];
    const defaultValue = "defaultValue" in spec ? spec.defaultValue : undefined;
    if (defaultValue !== undefined) {
      (resolved as Record<string, unknown>)[key] = parseCliOptionValue(
        key,
        defaultValue,
        "default"
      );
    }
  }
  return resolved;
};
