import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { rename, rm } from "fs/promises";
import { join } from "path";
import chalk from "chalk";

/**
 * Automatically migrates data/ to .blink/ if it exists.
 * This helps users transition from the old directory structure.
 */
export async function migrateDataToBlink(directory: string): Promise<void> {
  const oldPath = join(directory, "data");
  const newPath = join(directory, ".blink");

  // Check if data exists and .blink doesn't
  if (!existsSync(oldPath) || existsSync(newPath)) {
    return;
  }

  // Check if data contains any data files (chats, storage, config, devhook, .first-run)
  const hasData =
    existsSync(join(oldPath, "chats")) ||
    existsSync(join(oldPath, "storage.json")) ||
    existsSync(join(oldPath, "config.json")) ||
    existsSync(join(oldPath, "devhook.txt")) ||
    existsSync(join(oldPath, "devhook")) ||
    existsSync(join(oldPath, ".first-run"));

  if (!hasData) {
    return;
  }

  // Simple rename: data/ → .blink/
  console.log(chalk.yellow("Migrating data/ to .blink/..."));
  await rename(oldPath, newPath);

  // Update .gitignore if it exists
  const gitignorePath = join(directory, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");

    // Only update if 'data' is in gitignore and '.blink' is not
    if (content.includes("data") && !content.includes(".blink")) {
      const lines = content.split("\n");

      // Find where data is mentioned
      const dataIndex = lines.findIndex((line) =>
        line.trim().match(/^data\s*$/)
      );

      if (dataIndex !== -1) {
        // Replace data with .blink and add comment
        lines[dataIndex] = ".blink";
        // Add comment before if there isn't already one
        if (dataIndex === 0 || !lines[dataIndex - 1]?.trim().startsWith("#")) {
          lines.splice(dataIndex, 0, "# data has migrated to .blink/");
        }
      } else {
        // data not found, just append .blink at the end
        if (!content.endsWith("\n")) {
          lines.push("");
        }
        lines.push("# data has migrated to .blink/");
        lines.push(".blink");
      }

      writeFileSync(gitignorePath, lines.join("\n"));
      console.log(chalk.green("Updated .gitignore"));
    }
  }

  console.log(chalk.green("Migration complete!"));
}
