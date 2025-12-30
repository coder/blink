const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/welcome.tsx"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/welcome.js",
  loader: {
    ".tsx": "tsx",
    ".ts": "tsx",
    ".css": "empty",
  },
  external: ["electron", "@electron/remote", "@blink.so/api"],
  target: "node18",
  define: {
    "import.meta.url": JSON.stringify(""),
  },
};

if (watch) {
  esbuild.context(buildOptions).then((ctx) => {
    ctx.watch();
    console.log("Watching welcome.tsx...");
  });
} else {
  esbuild.build(buildOptions).catch(() => process.exit(1));
}
