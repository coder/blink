export type CliOptionParser<T> = (value: string | undefined) => T;

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export const parseTrimmedString: CliOptionParser<string | undefined> = (
  value
) => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const parseBooleanish = (value: string): boolean | undefined => {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
};

export const parseDevProxy: CliOptionParser<string | undefined> = (value) => {
  const parsed = parseTrimmedString(value);
  if (parsed === undefined) {
    return undefined;
  }
  const booleanish = parseBooleanish(parsed);
  if (booleanish === true) {
    return "localhost:3000";
  }
  if (booleanish === false) {
    return undefined;
  }
  return parsed;
};

export const parsePort: CliOptionParser<number> = (value) => {
  const stringValue = value?.trim();
  if (!stringValue) {
    throw new ParseError("value is required");
  }
  const port = parseInt(stringValue, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new ParseError(
      `"${stringValue}" is not a valid port (must be 1-65535)`
    );
  }
  return port;
};

export const parseBoolean: CliOptionParser<boolean> = (value) => {
  if (value === undefined) {
    return false;
  }
  const booleanish = parseBooleanish(value);
  if (booleanish === undefined) {
    throw new ParseError(
      `"${value}" is not a valid boolean (use true/false, yes/no, on/off, 1/0)`
    );
  }
  return booleanish;
};
