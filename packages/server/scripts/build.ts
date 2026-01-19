import { build } from "bun";
import { execSync } from "child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const distDir = join(import.meta.dirname, "..", "dist");
const repoRoot = join(import.meta.dirname, "..", "..", "..");

/**
 * buildServer builds the CLI for the server.
 */
async function buildServer() {
  await build({
    entrypoints: [join(__dirname, "..", "src", "cli.ts")],
    outdir: "dist",
    target: "node",
    format: "esm",
    minify: true,
  });
}

/**
 * buildNextSite builds the NextJS site and copies the necessary files to the dist directory.
 */
function buildNextSite() {
  const sitePackage = join(repoRoot, "internal", "site");

  execSync("bun run build", {
    cwd: sitePackage,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      // This ensures the site is bundled alone.
      NEXT_OUTPUT: "standalone",
    },
  });

  rmSync(join(distDir, "site"), { recursive: true, force: true });
  mkdirSync(join(distDir, "site"), { recursive: true });
  // This moves all of the compiled site and sources to run the server-side.
  cpSync(
    join(sitePackage, ".next", "standalone", "internal", "site", ".next"),
    join(distDir, "site", ".next"),
    { recursive: true }
  );
  // This copies all of the static assets.
  cpSync(
    join(sitePackage, ".next", "static"),
    join(distDir, "site", ".next", "static"),
    { recursive: true }
  );
  // This copies all public assets.
  cpSync(join(sitePackage, "public"), join(distDir, "site", "public"), {
    recursive: true,
  });
  // This copies the required server node_modules.
  cpSync(
    join(sitePackage, ".next", "standalone", "node_modules"),
    join(distDir, "site", "node_modules"),
    { recursive: true }
  );
  // Write minimal package.json for module.createRequire() to work.
  writeFileSync(
    join(distDir, "site", "package.json"),
    JSON.stringify({ type: "module" })
  );
}

function copyMigrations() {
  const databasePackage = join(repoRoot, "internal", "database");

  rmSync(join(distDir, "migrations"), { recursive: true, force: true });
  cpSync(join(databasePackage, "migrations"), join(distDir, "migrations"), {
    recursive: true,
  });
}

console.time("buildServer");
await buildServer();
console.timeEnd("buildServer");

if (process.env.BUILD_SITE) {
  console.time("buildNextSite");
  buildNextSite();
  console.timeEnd("buildNextSite");
}

console.time("copyMigrations");
copyMigrations();
console.timeEnd("copyMigrations");
