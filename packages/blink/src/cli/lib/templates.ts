import { readdir, readFile, writeFile } from "fs/promises";
import stringify from "json-stable-stringify";
import { join } from "path";

export async function generateTemplates(): Promise<
  Record<string, Record<string, string>>
> {
  const templatesDir = join(import.meta.dirname, "..", "init-templates");

  // Read all template directories
  const entries = await readdir(templatesDir, { withFileTypes: true });
  const templateDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const templates: Record<string, Record<string, string>> = {};

  // Read each template directory
  for (const templateId of templateDirs) {
    const templatePath = join(templatesDir, templateId);
    const files = await readdir(templatePath);

    templates[templateId] = {};

    for (const file of files) {
      const filePath = join(templatePath, file);
      const content = await readFile(filePath, "utf-8");

      // Strip "_noignore" prefix from filename if present
      const outputFilename = file.startsWith("_noignore")
        ? file.substring("_noignore".length)
        : file;

      templates[templateId][outputFilename] = content;
    }
  }
  return templates;
}
