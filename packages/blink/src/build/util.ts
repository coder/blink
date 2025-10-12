import { dirname, join } from "path";
import { stat } from "fs/promises";

/**
 * Finds the nearest entrypoint in the directory tree.
 *
 * @param startDir - The directory to start searching from.
 * @param name - The name of the entrypoint to find.
 * @returns The path to the entrypoint.
 */
export async function findNearestEntry(startDir: string, name: string) {
  let currentDir = startDir;

  while (currentDir !== dirname(currentDir)) {
    const file = join(currentDir, name);
    try {
      await stat(file);
      return file;
    } catch {
      // Ignore - it doesn't exist.
    }
    currentDir = dirname(currentDir);
  }

  return undefined;
}
