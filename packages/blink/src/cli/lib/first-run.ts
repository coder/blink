import { mkdirSync, existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * Checks if this is the first time the user is running `blink dev` in this directory.
 * If it is, marks it as not first time for future runs.
 *
 * @param directory - The agent directory
 * @returns true if this is the first time, false otherwise
 */
export function checkAndMarkFirstRun(directory: string): boolean {
  const storagePath = join(directory, "data", ".first-run");
  mkdirSync(dirname(storagePath), { recursive: true });

  if (existsSync(storagePath)) {
    return false;
  }

  // Mark as not first time for future runs
  writeFileSync(storagePath, new Date().toISOString());
  return true;
}
