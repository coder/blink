import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { rename, rm } from "fs/promises";
import { join } from "path";
import chalk from "chalk";

/**
 * Automatically migrates .blink/ to data/ if it exists.
 * This helps users transition from the old directory structure.
 */
export async function migrateBlinkToData(directory: string): Promise<void> {
  const oldPath = join(directory, ".blink");
  const newPath = join(directory, "data");

  // Check if .blink exists and data doesn't
  if (!existsSync(oldPath) || existsSync(newPath)) {
    return;
  }

  // Check if .blink/data/ exists (old nested structure)
  const oldNestedDataPath = join(oldPath, "data");
  const hasNestedData = existsSync(oldNestedDataPath);

  if (hasNestedData) {
    // Old structure: .blink/data/chats → data/chats
    console.log(chalk.yellow("Migrating .blink/data/ to data/..."));
    await rename(oldNestedDataPath, newPath);

    // Move any remaining files from .blink/ into data/
    const remainingFiles = readdirSync(oldPath);
    for (const file of remainingFiles) {
      const srcPath = join(oldPath, file);
      const destPath = join(newPath, file);
      if (!existsSync(destPath)) {
        await rename(srcPath, destPath);
      }
    }

    // Remove empty .blink directory
    await rm(oldPath, { recursive: true, force: true });
  } else {
    // Check if .blink contains any data files directly (build, chats, storage, config, devhook)
    const hasData =
      existsSync(join(oldPath, "build")) ||
      existsSync(join(oldPath, "chats")) ||
      existsSync(join(oldPath, "storage.json")) ||
      existsSync(join(oldPath, "config.json")) ||
      existsSync(join(oldPath, "devhook.txt"));

    if (!hasData) {
      return;
    }

    // Simple rename: .blink/ → data/
    console.log(chalk.yellow("Migrating .blink/ to data/..."));
    await rename(oldPath, newPath);
  }

  // Update .gitignore if it exists
  const gitignorePath = join(directory, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");

    // Only add if 'data' isn't already in gitignore
    if (!content.includes("data")) {
      const lines = content.split("\n");

      // Find where .blink is mentioned
      const blinkIndex = lines.findIndex((line) =>
        line.trim().match(/^\.blink\s*$/)
      );

      if (blinkIndex !== -1) {
        // Replace .blink with data and add comment
        lines[blinkIndex] = "data";
        // Add comment before if there isn't already one
        if (
          blinkIndex === 0 ||
          !lines[blinkIndex - 1]?.trim().startsWith("#")
        ) {
          lines.splice(blinkIndex, 0, "# .blink has migrated to data/");
        }
      } else {
        // .blink not found, just append data at the end
        if (!content.endsWith("\n")) {
          lines.push("");
        }
        lines.push("# .blink has migrated to data/");
        lines.push("data");
      }

      writeFileSync(gitignorePath, lines.join("\n"));
      console.log(chalk.green("Updated .gitignore"));
    }
  }

  console.log(chalk.green("Migration complete!"));
}
