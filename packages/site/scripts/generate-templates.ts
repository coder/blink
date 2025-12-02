import fs from "fs";
import path from "path";

interface TemplateMeta {
  name: string;
  description: string;
  [key: string]: any;
}

interface Template {
  meta: TemplateMeta;
  files: Record<string, string>;
}

const TEMPLATES_DIR = path.join(__dirname, "../../../vendor/blink/templates");
const OUTPUT_FILE = path.join(__dirname, "../templates.json");

async function generateTemplates() {
  const templates: Template[] = [];

  // Read all directories in templates folder
  const entries = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
  const templateDirs = entries.filter((entry) => entry.isDirectory());

  for (const dir of templateDirs) {
    const templatePath = path.join(TEMPLATES_DIR, dir.name);
    const metaPath = path.join(templatePath, "meta.json");

    // Check if meta.json exists
    if (!fs.existsSync(metaPath)) {
      console.log(`Skipping ${dir.name} - no meta.json found`);
      continue;
    }

    // Read meta.json
    const metaContent = fs.readFileSync(metaPath, "utf-8");
    const meta: TemplateMeta = JSON.parse(metaContent);

    // Read all files in the directory
    const files: Record<string, string> = {};
    const allFiles = fs.readdirSync(templatePath);

    for (const file of allFiles) {
      const filePath = path.join(templatePath, file);
      const stat = fs.statSync(filePath);

      // Only read files, not directories
      if (stat.isFile()) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          files[file] = content;
        } catch (error) {
          console.warn(`Could not read ${file}:`, error);
        }
      }
    }

    templates.push({
      meta,
      files,
    });

    console.log(`Processed template: ${meta.name}`);
  }

  // Write the output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(templates, null, 2));
  console.log(`\nGenerated ${OUTPUT_FILE} with ${templates.length} templates`);
}

generateTemplates().catch((error) => {
  console.error("Error generating templates:", error);
  process.exit(1);
});
