import path from "path";
import { existsSync } from "fs";
import type { BuildContext } from "./types";
import { buildWithEsbuild } from "./esbuild";

export * from "./types";

export interface Config {
  /**
   * entry is the path to the entry point of the agent.
   * Defaults to `src/agent.ts` or `agent.ts` in the current working directory.
   */
  entry?: string;

  /**
   * outdir is the directory to write the build output to.
   * Defaults to `.blink/build` in the current working directory.
   */
  outdir?: string;

  /**
   * build is invoked when the build starts.
   * This is triggered by `blink dev` or `blink build`.
   *
   * By default, this uses the `buildWithEsbuild` function.
   *
   * @param context - The build context.
   * @returns
   * @example
   * ```ts
   * import { defineConfig } from "blink/build";
   *
   * export default defineConfig({
   *   entry: "src/agent.ts",
   *   outdir: "dist",
   *   build: ({ entry, outdir, watch, onStart, onEnd }) => {
   *     await onStart();
   *     // ... perform build ...
   *     await onEnd({
   *       entry: "dist/agent.js",
   *       outdir: "dist",
   *       warnings: [],
   *     });
   *   }
   * })
   * ```
   */
  build?: (context: BuildContext) => Promise<void>;
}

export type ResolvedConfig = Required<Config>;

/**
 * defineConfig is a helper function for typing the config object.
 *
 * @param config - The config object.
 * @returns The config object.
 * @example
 * ```ts
 * import { defineConfig } from "blink/build";
 *
 * export default defineConfig({
 *   entry: "src/agent.ts",
 *   outdir: "dist",
 *   build: ({ entry, outdir, onBuildStart, onBuildEnd }) => {
 *
 *   }
 * })
 */
export function defineConfig(config?: Config): Config {
  return config ?? {};
}

/**
 * resolveConfig resolves the Blink config for a given directory.
 *
 * @param directory - The directory to resolve the config for.
 * @returns The resolved config.
 */
export function resolveConfig(directory: string): ResolvedConfig {
  const paths = ["blink.config.ts"];
  let config: Config | undefined;
  for (const configPath of paths) {
    const fullPath = path.resolve(directory, configPath);
    if (existsSync(fullPath)) {
      const resolved = require(fullPath);
      if (resolved.default) {
        config = { ...resolved.default };
        break;
      }
    }
  }

  if (!config) {
    config = {};
  }
  if (!config.entry) {
    const paths = ["src/agent.ts", "src/agent.js", "agent.ts", "agent.js"];
    for (const entryPath of paths) {
      const fullPath = path.resolve(directory, entryPath);
      if (existsSync(fullPath)) {
        config.entry = fullPath;
        break;
      }
    }

    if (!config.entry) {
      throw new Error(`Agent entrypoint not found.
        
Try creating "agent.ts" or specify "entry" in a blink.config.ts file.`);
    }
  }
  if (!config.outdir) {
    config.outdir = path.resolve(directory, ".blink/build");
  }
  if (!config.build) {
    // By default, we bundle with esbuild.
    config.build = buildWithEsbuild();
  }

  return config as ResolvedConfig;
}

export { buildWithEsbuild, setEsbuildInstance } from "./esbuild";
