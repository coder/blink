import { defineConfig, type UserConfig } from "tsdown";
import { noServerImports } from "./scripts/no-server-imports.ts";

const commonConfig: UserConfig = {
  format: ["esm", "cjs"],
  outDir: "dist/dist",
  dts: true,
  outputOptions: {
    inlineDynamicImports: true,
  },
};

export default defineConfig([
  {
    ...commonConfig,
    entry: ["src/client.browser.ts", "src/react/index.ts"],
    target: "chrome100",
    copy: [
      {
        from: "package.public.json",
        to: "dist/package.json",
      },
    ],
    plugins: [
      // This prevents any server code from being leaked to the client.
      noServerImports({
        // Default patterns should work for your naming convention
        // clientFilePattern: /\.client\./,
        // serverFilePattern: /\.server\./,

        // You can add additional server patterns if needed
        serverPatterns: [
          /\/server\//, // imports containing '/server/'
          /\.server$/, // imports ending with '.server'
          /middleware/, // middleware files (often server-only)
          /database/, // database-related imports
          /auth\.server/, // specific server auth files
        ],
      }),
    ],
  },
  {
    ...commonConfig,
    entry: ["src/client.node.ts"],
    target: "es2020",
    copy: [
      {
        from: "package.public.json",
        to: "dist/package.json",
      },
    ],
  },
]);
