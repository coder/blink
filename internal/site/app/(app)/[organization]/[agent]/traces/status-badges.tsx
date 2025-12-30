interface SpanStatusBadgeProps {
  statusCode: string;
}

export function SpanStatusBadge({ statusCode }: SpanStatusBadgeProps) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded flex-shrink-0 ${
        statusCode === "ERROR"
          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
          : statusCode === "OK"
            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
            : "bg-neutral-100 text-neutral-800 dark:bg-neutral-700/30 dark:text-neutral-400"
      }`}
    >
      {statusCode}
    </span>
  );
}

interface LogLevelBadgeProps {
  level: "info" | "error" | "warn";
}

export function LogLevelBadge({ level }: LogLevelBadgeProps) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded flex-shrink-0 ${
        level === "error"
          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
          : level === "warn"
            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
            : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
      }`}
    >
      {level.toUpperCase()}
    </span>
  );
}
