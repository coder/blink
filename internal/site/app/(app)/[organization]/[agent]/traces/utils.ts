// Helper function to format duration from nanoseconds with appropriate units
export const formatDuration = (durationNs: string) => {
  const ns = BigInt(durationNs);
  if (ns < BigInt(1_000)) {
    return `${ns}ns`;
  } else if (ns < BigInt(1_000_000)) {
    return `${(Number(ns) / 1_000).toFixed(2)}μs`;
  } else if (ns < BigInt(1_000_000_000)) {
    return `${(Number(ns) / 1_000_000).toFixed(2)}ms`;
  } else {
    return `${(Number(ns) / 1_000_000_000).toFixed(2)}s`;
  }
};

// Helper function to format date in user's timezone with the desired format
export const formatTimestamp = (dateString: string) => {
  const suffix = dateString.endsWith("Z") ? "" : "Z";
  const date = new Date(dateString + suffix);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
};

// Helper function to get timezone display
export const getTimezoneDisplay = () => {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const sign = offset >= 0 ? "+" : "-";
  return `GMT${sign}${hours}${minutes > 0 ? `:${minutes.toString().padStart(2, "0")}` : ""}`;
};

export const addMs = (date: Date, ms: number): Date => {
  return new Date(date.getTime() + ms);
};
