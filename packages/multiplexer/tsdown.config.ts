import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/multiplexer.ts"],
  platform: "node",
  format: ["esm", "cjs"],
  dts: true,
  outputOptions: {
    inlineDynamicImports: true,
  },
});
