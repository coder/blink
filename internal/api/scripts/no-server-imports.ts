// This file detects any server imports from client files.
// Client files are distributed via the @blink.so/api package.

import { readFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import type { Plugin } from "rolldown";

interface NoServerImportsOptions {
  /**
   * Pattern to identify client files (default: files containing '.client.')
   */
  clientFilePattern?: RegExp;

  /**
   * Pattern to identify server files (default: files containing '.server.')
   */
  serverFilePattern?: RegExp;

  /**
   * Additional patterns that should be considered server-only
   */
  serverPatterns?: RegExp[];
}

/**
 * A Rollup/Rolldown plugin that prevents server code imports in client files
 */
export function noServerImports(options: NoServerImportsOptions = {}): Plugin {
  const {
    clientFilePattern = /\.client\./,
    serverFilePattern = /\.server\./,
    serverPatterns = [],
  } = options;

  const allServerPatterns = [serverFilePattern, ...serverPatterns];

  function checkImports(filePath: string, code: string) {
    const violations: Array<{
      line: number;
      statement: string;
      importPath: string;
    }> = [];

    const lines = code.split("\n");

    // Match various import patterns
    const importPatterns = [
      /^import\s+.*?\s+from\s+['"]([^'"]+)['"];?/,
      /^import\s+['"]([^'"]+)['"];?/,
      /^import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      /^export\s+.*?\s+from\s+['"]([^'"]+)['"];?/,
      /^export\s*\*\s+from\s+['"]([^'"]+)['"];?/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      for (const pattern of importPatterns) {
        const match = pattern.exec(line);
        if (match) {
          const importPath = match[1];

          if (isServerImport(filePath, importPath)) {
            violations.push({
              line: i + 1,
              statement: line,
              importPath,
            });
          }
        }
      }
    }

    return violations;
  }

  function isServerImport(filePath: string, importPath: string): boolean {
    // Check if the import path directly indicates a server file
    for (const pattern of allServerPatterns) {
      if (pattern.test(importPath)) {
        console.log("server import", pattern, filePath, importPath);
        return true;
      }
    }

    // For relative imports, resolve the path and check if it points to a server file
    if (importPath.startsWith(".")) {
      try {
        const fileDir = dirname(filePath);
        const resolvedPath = resolve(fileDir, importPath);

        // Check various possible extensions
        const possiblePaths = [
          resolvedPath,
          resolvedPath + ".ts",
          resolvedPath + ".js",
          resolvedPath + "/index.ts",
          resolvedPath + "/index.js",
        ];

        for (const possiblePath of possiblePaths) {
          for (const pattern of allServerPatterns) {
            if (pattern.test(possiblePath)) {
              return true;
            }
          }
        }
      } catch {
        // If resolution fails, be conservative and don't flag it
        return false;
      }
    }

    return false;
  }

  return {
    name: "no-server-imports",

    buildStart() {
      // Initialize plugin
    },

    resolveId(id: string, importer?: string) {
      // Let other plugins handle the resolution first
      return null;
    },

    load(id: string) {
      // Only process client files
      if (!clientFilePattern.test(id)) {
        return null;
      }

      try {
        const code = readFileSync(id, "utf-8");
        const violations = checkImports(id, code);

        if (violations.length > 0) {
          const relativePath = relative(process.cwd(), id);
          let errorMessage = `❌ Server imports detected in client file: ${relativePath}\n\n`;

          for (const violation of violations) {
            errorMessage += `  Line ${violation.line}: ${violation.statement}\n`;
            errorMessage += `    ↳ "${violation.importPath}" appears to be a server import\n\n`;
          }

          errorMessage +=
            "Client files must not import server-only code to maintain proper separation of concerns.";

          // Throw an error to stop the build
          throw new Error(errorMessage);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Server imports detected")
        ) {
          throw error;
        }
        // If it's a file reading error, let it pass through
        return null;
      }

      return null;
    },
  };
}
