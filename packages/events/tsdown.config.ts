import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/events.ts"],
  platform: "node",
  format: ["esm", "cjs"],
  dts: true,
  outputOptions: {
    inlineDynamicImports: true,
  },
});
