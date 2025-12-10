import { build } from "bun";
import { execSync } from "child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "fs";
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
  const sitePackage = join(repoRoot, "packages", "site");

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
    join(sitePackage, ".next", "standalone", "packages", "site", ".next"),
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

  // Create symlinks for packages in .bun directory so Node.js can resolve them.
  // Bun uses a .bun directory structure instead of flat node_modules, so we need
  // to create symlinks at the top level pointing to the actual packages.
  const bunDir = join(distDir, "site", "node_modules", ".bun");
  const nodeModulesDir = join(distDir, "site", "node_modules");
  const bunDirExists = existsSync(bunDir);
  for (const entry of bunDirExists ? readdirSync(bunDir) : []) {
    // Skip non-package entries
    if (entry === "node_modules" || entry.startsWith(".")) continue;

    // Parse package name from entry (e.g., "next@15.5.6+..." -> "next")
    // or ("@img+sharp-linux-arm64@0.34.5" -> "@img/sharp-linux-arm64")
    const atIndex = entry.lastIndexOf("@");
    if (atIndex <= 0) continue; // Skip if no version found

    let packageName = entry.slice(0, atIndex);
    // Handle scoped packages (bun uses + instead of /)
    if (packageName.startsWith("@") && packageName.includes("+")) {
      packageName = packageName.replace("+", "/");
    }

    const targetPath = packageName.includes("/")
      ? join(nodeModulesDir, ...packageName.split("/"))
      : join(nodeModulesDir, packageName);

    // Create parent directory for scoped packages
    if (packageName.includes("/")) {
      const scope = packageName.split("/")[0]!;
      mkdirSync(join(nodeModulesDir, scope), { recursive: true });
    }

    // Create relative symlink
    const relativePath = join(
      ".bun",
      entry,
      "node_modules",
      ...packageName.split("/")
    );
    try {
      symlinkSync(relativePath, targetPath);
    } catch {
      // Symlink may already exist
    }
  }
}

function copyMigrations() {
  const databasePackage = join(repoRoot, "packages", "database");

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
