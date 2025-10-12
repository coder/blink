/**
 * esbuild plugin that automatically enables telemetry for Vercel AI SDK functions
 * by wrapping the 'ai' package exports with default telemetry configuration.
 *
 * This plugin intercepts imports from the 'ai' package and wraps the functions
 * (streamText, generateText, etc.) to automatically inject experimental_telemetry
 * when not explicitly provided.
 *
 * Usage:
 * ```ts
 * import { aiTelemetryPlugin } from './esbuild-ai-telemetry-plugin';
 *
 * esbuild.build({
 *   plugins: [aiTelemetryPlugin()],
 *   // ... other config
 * });
 * ```
 */

import type {
  Plugin,
  PluginBuild,
  OnResolveArgs,
  OnLoadArgs,
  OnLoadResult,
} from "esbuild";

export interface TelemetryConfig {
  /**
   * Enable or disable telemetry. Disabled by default while experimental.
   */
  isEnabled?: boolean;

  /**
   * Enable or disable input recording. Enabled by default.
   */
  recordInputs?: boolean;

  /**
   * Enable or disable output recording. Enabled by default.
   */
  recordOutputs?: boolean;

  /**
   * Identifier for this function. Used to group telemetry data by function.
   */
  functionId?: string;

  /**
   * Additional information to include in the telemetry data.
   */
  metadata?: Record<string, unknown>;
}

export interface AiTelemetryPluginOptions {
  /**
   * AI SDK functions to wrap with telemetry injection.
   * @default ['streamText', 'generateText', 'generateObject', 'streamObject', 'embed', 'embedMany']
   */
  functions?: string[];

  /**
   * Telemetry configuration to inject as default when not provided.
   * @default { isEnabled: true }
   */
  telemetryConfig?: TelemetryConfig;
}

interface PluginData {
  resolveDir?: string;
}

const AI_WRAPPER_NAMESPACE = "ai-telemetry-wrapper" as const;

/**
 * Creates an esbuild plugin that wraps Vercel AI SDK functions to automatically
 * inject telemetry configuration.
 *
 * @param options - Plugin configuration options
 * @returns esbuild plugin
 *
 * @example
 * ```ts
 * import * as esbuild from 'esbuild';
 * import { aiTelemetryPlugin } from './plugins/ai-telemetry';
 *
 * await esbuild.build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/bundle.js',
 *   plugins: [aiTelemetryPlugin()],
 * });
 * ```
 */
export function aiTelemetryPlugin(
  options: AiTelemetryPluginOptions = {}
): Plugin {
  const {
    functions = [
      "streamText",
      "generateText",
      "generateObject",
      "streamObject",
      "embed",
      "embedMany",
    ],
    telemetryConfig = { isEnabled: true },
  } = options;

  return {
    name: "ai-telemetry",
    setup(build: PluginBuild): void {
      // Intercept imports from 'ai' package
      build.onResolve({ filter: /^ai$/ }, (args: OnResolveArgs) => {
        // Skip if this is already from our wrapper (prevent infinite loop)
        if (args.namespace === AI_WRAPPER_NAMESPACE) {
          // Let esbuild resolve 'ai' normally (will either bundle or mark external)
          return undefined;
        }

        // Wrap the 'ai' package
        return {
          path: "ai",
          namespace: AI_WRAPPER_NAMESPACE,
          pluginData: {
            resolveDir: args.resolveDir,
          } satisfies PluginData,
        };
      });

      // Load the wrapped version of the 'ai' package
      build.onLoad(
        { filter: /^ai$/, namespace: AI_WRAPPER_NAMESPACE },
        (args: OnLoadArgs): OnLoadResult => {
          const telemetryStr = JSON.stringify(telemetryConfig);
          const pluginData = args.pluginData as PluginData | undefined;

          // Import everything from the original 'ai' package into a namespace
          // When esbuild tries to resolve 'ai' from within this module, our onResolve
          // will return undefined (due to namespace check), so it will use default resolution
          const wrapperCode = `
// Import everything from the original 'ai' package
import * as aiOriginal from 'ai';

// Re-export everything from 'ai'
export * from 'ai';

// Create wrapped versions that inject telemetry by default
${functions
  .map(
    (fnName) => `
export function ${fnName}(options) {
  // If experimental_telemetry is not provided, inject the default
  if (!options || !options.experimental_telemetry) {
    return aiOriginal.${fnName}({
      ...options,
      experimental_telemetry: ${telemetryStr}
    });
  }
  // If it's already provided, use the original function as-is
  return aiOriginal.${fnName}(options);
}
`
  )
  .join("")}
`;

          return {
            contents: wrapperCode,
            loader: "js",
            resolveDir: pluginData?.resolveDir,
          };
        }
      );
    },
  };
}
