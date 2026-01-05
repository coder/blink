import type { StorybookConfig } from "@storybook/nextjs-vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Inspect from "vite-plugin-inspect";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  features: {
    experimentalRSC: true,
  },
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  viteFinal: async (config) => {
    const basePath = path.resolve(fileURLToPath(import.meta.url), "../../");
    config.define = {
      __dirname: JSON.stringify("/"),
    };

    // Ensure '@' alias points to the site root so '@/...' imports resolve in stories
    config.resolve ||= {};
    (config.resolve as any).alias ||= {};
    (config.resolve as any).alias["@"] = basePath;

    // This is a custom resolver plugin that looks for `mock.ts` files to replace
    // original files when being imported. This allows us to mock server actions,
    // database queries, etc.
    //
    // All RSC components are actually rendered in the browser.
    const mockResolverPlugin = {
      name: "storybook-mock-resolver",
      enforce: "pre" as const, // Run before other plugins

      async resolveId(source, importer, options) {
        // Handle @/ alias resolution
        let resolvedPath;
        if (source.startsWith("@/")) {
          // Convert @/ to basePath (where tsconfig.json maps @/* to ./*)
          resolvedPath = path.join(basePath, source.slice(2));
        } else if (path.isAbsolute(source)) {
          // Handle absolute paths
          resolvedPath = source;
        } else {
          // Handle relative paths by resolving against the importer directory
          const importerDir = path.dirname(importer || "");
          resolvedPath = path.resolve(importerDir, source);
        }

        // Check if this is a path we want to potentially mock
        const relativePath = path.relative(basePath, resolvedPath);
        if (
          relativePath.startsWith("app/") ||
          relativePath.startsWith("lib/")
        ) {
          // Remove file extension and look for mock files
          const withoutSuffix = path.join(
            path.dirname(resolvedPath),
            path.basename(resolvedPath, path.extname(resolvedPath))
          );

          for (const ext of [
            ".mock.ts",
            ".mock.tsx",
            ".mock.js",
            ".mock.jsx",
          ]) {
            const mockPath = withoutSuffix + ext;
            if (fs.existsSync(mockPath)) {
              console.log(
                `[Mocking] ${path.relative(basePath, resolvedPath)} -> ${path.relative(basePath, mockPath)}`
              );
              return mockPath;
            }
          }
        }

        // Let other plugins handle the resolution (including the original file)
        return null;
      },
    };

    config.plugins ||= [];
    config.plugins.push(mockResolverPlugin);
    config.plugins.push(Inspect());
    config.plugins.push(nodePolyfills());

    return mergeConfig(config, {
      server: { watch: { usePolling: true, interval: 1000 } },
    });
  },
};
export default config;
