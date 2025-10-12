import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export function getDevhookID(directory: string): string {
  const storagePath = join(directory, "data", "devhook.txt");
  mkdirSync(dirname(storagePath), { recursive: true });
  if (existsSync(storagePath)) {
    return readFileSync(storagePath, "utf-8");
  }
  const id = crypto.randomUUID();
  writeFileSync(storagePath, id);
  return id;
}
