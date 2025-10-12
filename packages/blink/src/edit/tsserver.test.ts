import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TSServer } from "./tsserver";

// These take a long time to run.
describe.skip("TSServer", () => {
  let tempDir: string;
  let server: TSServer | undefined;

  afterEach(async () => {
    if (server) {
      server.close();
      server = undefined;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should get completions for a simple TypeScript file", async () => {
    // Create a temporary directory with a TypeScript file
    tempDir = await mkdtemp(join(tmpdir(), "tsserver-test-"));

    const testFile = "test.ts";
    const testFilePath = join(tempDir, testFile);
    await writeFile(
      testFilePath,
      `const greeting = "Hello, world!";\ngreeting.`
    );

    // Create tsconfig.json
    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2020",
          module: "commonjs",
        },
      })
    );

    // Create and use the server
    server = new TSServer(tempDir);

    // Open the file
    await server.openFile(testFile);

    // Get completions at the end of "greeting."
    const completions = await server.getCompletions(testFile, 2, 10);

    // Should have string methods as completions
    expect(completions).toBeDefined();
    expect(completions.entries).toBeDefined();
    expect(completions.entries.length).toBeGreaterThan(0);

    // Check for common string methods
    const completionNames = completions.entries.map((entry: any) => entry.name);
    expect(completionNames).toContain("length");
    expect(completionNames).toContain("toUpperCase");
    expect(completionNames).toContain("toLowerCase");
  }, 10000);

  test("should get quick info for a variable", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tsserver-test-"));

    const testFile = "test.ts";
    await writeFile(
      join(tempDir, testFile),
      `const greeting: string = "Hello";\n`
    );
    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "es2020" } })
    );

    server = new TSServer(tempDir);
    await server.openFile(testFile);

    // Get quick info for "greeting" variable (line 1, column 7)
    const info = await server.getQuickInfo(testFile, 1, 7);

    expect(info).toBeDefined();
    expect(info.displayString).toBeDefined();
    expect(info.displayString).toContain("const greeting");
  }, 10000);

  test("should get diagnostics for invalid TypeScript", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tsserver-test-"));

    const testFile = "test.ts";
    await writeFile(
      join(tempDir, testFile),
      `const x: number = "string"; // Type error\n`
    );
    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "es2020", strict: true } })
    );

    server = new TSServer(tempDir);
    await server.openFile(testFile);

    const diagnostics = await server.getSemanticDiagnostics(testFile);

    expect(diagnostics).toBeDefined();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].text).toContain("string");
  }, 10000);
});
