import type * as esbuild from "esbuild";
import type { BuildContext } from "./types";
import { builtinModules } from "module";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { rm } from "fs/promises";
import { aiTelemetryPlugin } from "./plugins/ai-telemetry";

// Global esbuild instance that can be set by consumers (e.g., desktop app)
let _esbuildInstance: typeof esbuild | undefined;

/**
 * setEsbuildInstance allows consumers to provide their own esbuild instance.
 * This is useful for bundled environments (like Electron) where dynamic imports
 * might not resolve correctly.
 */
export function setEsbuildInstance(instance: typeof esbuild) {
  _esbuildInstance = instance;
}

export function buildWithEsbuild(
  options?: esbuild.BuildOptions
): (context: BuildContext) => Promise<void> {
  return async (context: BuildContext) => {
    const esbuild =
      _esbuildInstance ??
      ((await import("esbuild")) as typeof import("esbuild"));
    const ctx = await esbuild.context({
      entryPoints: [context.entry],
      outdir: context.outdir,
      bundle: true,
      write: false,
      logLevel: "silent",
      format: "esm",
      platform: "node",
      target: "node22",
      sourcemap: false,
      mainFields: ["module", "main"],
      conditions: ["import", "module"],
      plugins: [
        {
          name: "blink-esm-require-to-import",
          setup(build) {
            build.onEnd((result) => {
              if (
                build.initialOptions.format !== "esm" ||
                build.initialOptions.platform !== "node"
              ) {
                return;
              }

              // Process each output file
              result.outputFiles?.forEach((file) => {
                if (file.path.endsWith(".js") || file.path.endsWith(".mjs")) {
                  let contents = Buffer.from(file.contents).toString("utf-8");
                  const modules = new Map();

                  // Regex to match __require("module_name") calls for Node built-ins
                  // Handles both "fs" and "node:fs" style imports, including subpaths like "stream/web"
                  const rx = new RegExp(
                    `\\b__require\\("(node:)?(${builtinModules.join("|")})(/[^"]+)?"\\)`,
                    "gm"
                  );

                  // Replace __require calls with import identifiers
                  contents = contents.replace(
                    rx,
                    (match, nodePrefix, moduleName, subpath = "") => {
                      const fullModuleName = moduleName + subpath;
                      const importId = `__import_${fullModuleName.toUpperCase().replace(/[/-]/g, "_")}`;
                      // Always normalize to node: prefix for built-in modules
                      const importFrom = `node:${fullModuleName}`;
                      // Use importId as key to deduplicate
                      modules.set(importId, importFrom);
                      return importId;
                    }
                  );

                  // Add import statements at the top
                  if (modules.size > 0) {
                    const imports = Array.from(modules.entries())
                      .map(([id, mod]) => `import ${id} from "${mod}";`)
                      .join("\n");

                    contents = imports + "\n\n" + contents;
                  }

                  // Update the file contents
                  file.contents = Buffer.from(contents, "utf-8");
                }
              });
            });
          },
        },

        {
          name: "blink-dev-server",
          setup(build) {
            let start: number;
            build.onStart(() => {
              context.onStart();
              start = performance.now();
            });

            build.onEnd(async (result) => {
              // Clear all files from the output directory.
              await rm(context.outdir, { recursive: true, force: true });
              await mkdir(context.outdir, { recursive: true });
              const files =
                result.outputFiles?.map((f) => ({
                  path: f.path,
                  contents: f.contents,
                })) ?? [];
              files.push({
                path: path.resolve(context.outdir, "package.json"),
                contents: Buffer.from(
                  JSON.stringify(
                    {
                      type: "module",
                    },
                    null,
                    2
                  ),
                  "utf-8"
                ),
              });
              for (const file of files) {
                await writeFile(file.path, file.contents);
              }

              if (result.errors.length > 0) {
                context.onResult({
                  error: {
                    message: result.errors
                      .map((e) => `${e.text} (${e.location?.file})`)
                      .join("\n"),
                  },
                });
              } else {
                context.onResult({
                  entry: path.resolve(
                    context.outdir,
                    path.basename(context.entry).replace(".ts", ".js")
                  ),
                  duration: performance.now() - start,
                  outdir: context.outdir,
                  warnings: result.warnings.map((w) => ({
                    message: w.text,
                    file: w.location?.file,
                  })),
                });
              }

              if (!context.watch) {
                // These must not await here, otherwise the process will hang.
                ctx.dispose();
                ctx.cancel();
              }
            });
          },
        },
        aiTelemetryPlugin(),
      ],
      ...options,
    });

    await ctx.watch();
  };
}
