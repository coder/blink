import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * Gets the path to the devhook ID file.
 */
export function getDevhookPath(directory: string): string {
  return join(directory, "data", "devhook.txt");
}

/**
 * Checks if a devhook ID exists for this directory.
 */
export function hasDevhook(directory: string): boolean {
  return existsSync(getDevhookPath(directory));
}

/**
 * Gets the devhook ID for this directory, if it exists.
 * Returns undefined if no devhook has been created.
 */
export function getDevhookID(directory: string): string | undefined {
  const storagePath = getDevhookPath(directory);
  if (existsSync(storagePath)) {
    return readFileSync(storagePath, "utf-8");
  }
  return undefined;
}

/**
 * Creates and returns a devhook ID for this directory.
 * Only call this if the agent has a request handler.
 */
export function createDevhookID(directory: string): string {
  const storagePath = getDevhookPath(directory);
  mkdirSync(dirname(storagePath), { recursive: true });

  // If it already exists, return it
  if (existsSync(storagePath)) {
    return readFileSync(storagePath, "utf-8");
  }

  // Create new ID
  const id = crypto.randomUUID();
  writeFileSync(storagePath, id);
  return id;
}
