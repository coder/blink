import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { inspect } from "util";
import { resolveConfig } from "../build/index";
import { findNearestEntry } from "../build/util";
import { startDev } from "../tui/dev";
import { getAuthToken } from "./lib/auth";
import { migrateDataToBlink } from "./lib/migrate";

export default async function dev(directory?: string): Promise<void> {
  if (!directory) {
    const cwd = process.cwd();

    // Try to resolve config in current directory
    try {
      resolveConfig(cwd);
      directory = cwd;
    } catch {
      // No agent found in current directory, search upward for .blink
      let dotBlinkPath = await findNearestEntry(cwd, ".blink");

      // This is legacy behavior to migrate old Blink directories to the new .blink/ directory.
      if (dotBlinkPath && existsSync(join(dotBlinkPath, "build"))) {
        dotBlinkPath = undefined;
      }

      if (dotBlinkPath) {
        directory = dotBlinkPath;
      } else {
        // Use the current working directory
        directory = cwd;
      }
    }
  }
  // Auto-migrate data/ to .blink/ if it exists
  await migrateDataToBlink(directory);

  const exitWithDump = (error: Error) => {
    writeFileSync("error.dump", inspect(error, { depth: null }));
    process.exit(1);
  };
  process.addListener("uncaughtException", (error) => {
    exitWithDump(error);
  });
  process.addListener("unhandledRejection", (error) => {
    exitWithDump(error as Error);
  });

  try {
    await startDev({ directory });
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}
