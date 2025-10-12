import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/client.ts",
    "./src/server.ts",
    "./src/schema.ts",
    "./src/transport.ts",
  ],
  platform: "node",
  format: ["esm", "cjs"],
  dts: true,
  outputOptions: {
    inlineDynamicImports: true,
  },
});
