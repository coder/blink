import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  outDir: "./dist",
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  // This sucks but we need to bundle exa-js because of some jank
  // with "node-fetch" v2 imported from "cross-fetch".
  //
  // We still have it as a dependency for the types.
  noExternal: ["exa-js"],
});
