import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./lib/index.ts"],
  platform: "node",
  format: ["esm", "cjs"],
  dts: true,
  outputOptions: {
    inlineDynamicImports: true,
  },
});
