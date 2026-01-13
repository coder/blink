import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface BlinkConfig {
  organizationId?: string;
  agentId?: string;
}

export async function writeBlinkConfig(
  directory: string,
  config: BlinkConfig
): Promise<void> {
  const configPath = join(directory, ".blink", "config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        _: "This file can be source controlled. It contains no secrets.",
        ...config,
      },
      null,
      2
    ),
    "utf-8"
  );
}
