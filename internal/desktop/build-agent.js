const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/agent.tsx"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/agent.js",
  loader: {
    ".tsx": "tsx",
    ".ts": "tsx",
    ".css": "empty",
  },
  inject: ["src/shim.js"],
  external: ["electron", "@electron/remote", "esbuild", "@blink.so/api"],
  target: "node18",
  define: {
    "import.meta.url": JSON.stringify(""),
  },
};

if (watch) {
  esbuild.context(buildOptions).then((ctx) => {
    ctx.watch();
    console.log("Watching agent.tsx...");
  });
} else {
  esbuild.build(buildOptions).catch(() => process.exit(1));
}
