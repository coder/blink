import { defineConfig, type CopyEntry } from "tsdown";
import { dirname, join } from "path";
import { stat, readFile, writeFile, mkdir } from "fs/promises";
import Sonda from "sonda/rolldown";

const copies: CopyEntry[] = [];
const lydellNodePtyCopiedPaths: Record<string, string> = {};

// ensureLydellPtyNodeFiles downloads the node files for lydell/node-pty.
// We do this to avoid an external dependency on the lydell/node-pty package.
const ensureLydellPtyNodeFiles = async () => {
  const lydellPtyVersion = new URL(
    dirname(import.meta.resolve("@lydell/node-pty")) + "/package.json"
  ).pathname;
  const lydellPtyPackage = await readFile(lydellPtyVersion, "utf-8");
  const lydellPtyPackageJson = JSON.parse(lydellPtyPackage);
  const version = lydellPtyPackageJson.version;
  // The Windows versions are massive (5MB+), so we don't bundle them.
  // All of these combined are <300KB (uncompressed) at the time of writing.
  const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
  for (const platform of platforms) {
    const cachedPath = join(
      import.meta.dirname,
      "node_modules",
      ".blink-build",
      `lydell-node-pty-${version}-${platform}.node`
    );
    lydellNodePtyCopiedPaths[platform] = `lydell-node-pty-${platform}.node`;
    copies.push({
      from: cachedPath,
      to: join("dist", "cli", `lydell-node-pty-${platform}.node`),
    });

    try {
      await stat(cachedPath);
      // It already exists, so we can skip downloading it.
      continue;
    } catch {}
    const resp = await fetch(
      `https://unpkg.com/@lydell/node-pty-${platform}@${version}/pty.node`
    );
    if (!resp.ok) {
      console.log("Failed to download", platform);
    }
    await mkdir(dirname(cachedPath), { recursive: true });
    await writeFile(cachedPath, Buffer.from(await resp.arrayBuffer()));
  }
};
await ensureLydellPtyNodeFiles();

const external = ["esbuild", "ai", "zod", "node-pty", "@lydell/node-pty"];

export default defineConfig([
  {
    entry: [
      "./src/agent/index.node.ts",
      "./src/build/index.ts",
      "./src/react/index.node.ts",
      "./src/internal/index.ts",
    ],
    platform: "node",
    format: ["esm", "cjs"],
    external,
    dts: true,
    minify: true,
    outputOptions: {
      dir: "dist/node",
    },
    plugins: [Sonda()],
  },
  {
    // These are all bundled for the browser so non-Node clients can use them.
    entry: [
      "./src/agent/client/index.ts",
      "./src/agent/index.browser.ts",
      "./src/control/index.ts",
      "./src/react/index.browser.ts",
    ],
    platform: "browser",
    format: ["esm", "cjs"],
    external: [...external, "react"],
    dts: true,
    minify: true,
    outputOptions: {
      dir: "dist/browser",
    },
  },
  {
    entry: "./src/cli/index.ts",
    platform: "node",
    external,
    format: ["esm"],
    target: "node22",
    copy: copies,
    dts: true,
    minify: true,
    outputOptions: {
      dir: "dist/cli",
    },
    plugins: [
      {
        name: "package-lydell-node-pty",
        transform(code, id) {
          if (!id.includes("@lydell/node-pty/requireBinary.js")) {
            return code;
          }
          return code.replace(
            `return require(PACKAGE_NAME + "/" + file);`,
            `
  const platform = process.platform + "-" + process.arch;
  switch (platform) {
    ${Object.keys(lydellNodePtyCopiedPaths)
      .map(
        (key) => `
      case "${key}":
        return require(import.meta.dirname + "/" + "${lydellNodePtyCopiedPaths[key]}");
    `
      )
      .join("\n")}
  }
  return require(PACKAGE_NAME + "/" + file);
  `
          );
        },
      },
    ],
  },
]);
