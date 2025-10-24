import { createContext, useContext } from "react";

// This lets us serialize log writes without using async log and error methods.
let logQueue: Promise<void> = Promise.resolve();

export type Source = "system" | "agent";

type PrintLog = (
  level: "error" | "log",
  source: Source,
  ...message: unknown[]
) => Promise<void>;

export class Logger {
  constructor(private printLog: PrintLog) {}

  setPrintLog(printLog: PrintLog): void {
    this.printLog = printLog;
  }

  error(source: Source, ...message: [unknown, ...unknown[]]): void {
    logQueue = logQueue.then(() =>
      this.printLog("error", source, ...message).catch((err) => {
        console.error("Error printing log:", err);
      })
    );
  }

  log(source: Source, ...message: [unknown, ...unknown[]]): void {
    logQueue = logQueue.then(() =>
      this.printLog("log", source, ...message).catch((err) => {
        console.error("Error printing log:", err);
      })
    );
  }

  flush(): Promise<void> {
    return logQueue;
  }
}

export const LoggerContext = createContext<Logger | undefined>(undefined);

export const useLogger = (): Logger => {
  const logger = useContext(LoggerContext);
  if (!logger) {
    throw new Error("useLogger must be used within a LoggerProvider");
  }
  return logger;
};
