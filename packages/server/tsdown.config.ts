import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/main.ts",
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  dts: false,
  // Only externalize Next.js
  external: [/^next/],
  // Use shims to ensure circular deps work
  shims: true,
  onSuccess: async () => {
    console.log("\n📦 Building production assets...");

    const rootDir = join(import.meta.dirname, "..", "..");
    const siteDir = join(rootDir, "packages", "site");
    const dbDir = join(rootDir, "packages", "database");
    const distDir = join(import.meta.dirname, "dist");
    const siteBuildDir = join(distDir, "site");

    // Build Next.js site in its source directory
    console.log("🔨 Building Next.js site...");
    execSync("bun run build", {
      cwd: siteDir,
      stdio: "inherit",
    });

    // Copy only essential parts of .next folder (exclude cache)
    const nextBuildSource = join(siteDir, ".next");
    const nextBuildTarget = join(siteBuildDir, ".next");

    if (existsSync(nextBuildSource)) {
      console.log("📄 Copying Next.js build output (excluding cache)...");
      mkdirSync(siteBuildDir, { recursive: true });

      // Copy only the essential directories
      const essentialDirs = [
        "server",
        "static",
        "types",
        "app-paths-manifest.json",
        "build-manifest.json",
        "package.json",
        "prerender-manifest.json",
        "react-loadable-manifest.json",
        "required-server-files.json",
        "routes-manifest.json",
      ];

      for (const item of essentialDirs) {
        const src = join(nextBuildSource, item);
        const dest = join(nextBuildTarget, item);
        if (existsSync(src)) {
          cpSync(src, dest, { recursive: true });
        }
      }
    } else {
      throw new Error("Next.js build not found at " + nextBuildSource);
    }

    // Copy public folder if exists
    const publicSource = join(siteDir, "public");
    if (existsSync(publicSource)) {
      console.log("📄 Copying public assets...");
      cpSync(publicSource, join(siteBuildDir, "public"), { recursive: true });
    }

    // Copy migrations
    const migrationsSource = join(dbDir, "migrations");
    const migrationsTarget = join(distDir, "migrations");

    if (existsSync(migrationsSource)) {
      console.log("📄 Copying migrations...");
      cpSync(migrationsSource, migrationsTarget, { recursive: true });
    }

    // Create minimal package.json for external dependencies
    const packageJsonPath = join(distDir, "package.json");
    const packageJson = {
      type: "module",
      dependencies: {
        next: "*",
        pg: "*",
        "drizzle-orm": "*",
      },
    };
    console.log("📄 Creating package.json...");
    cpSync(join(import.meta.dirname, "package.json"), packageJsonPath);

    console.log("✅ Build complete!");
    console.log(`   Server: ${distDir}/main.js + chunks`);
    console.log(`   Site: ${siteBuildDir}/`);
    console.log(`   Migrations: ${migrationsTarget}/`);
    console.log(`\n📝 Next steps:`);
    console.log(`   cd dist && bun install (for Next.js)`);
    console.log(`   bun run start:prod`);
  },
});
