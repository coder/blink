import { describe, test, expect, mock } from "bun:test";
import * as esbuild from "esbuild";
import { aiTelemetryPlugin } from "./ai-telemetry";
import { readFile, rm, writeFile, mkdir } from "fs/promises";
import path from "path";
import { tmpdir } from "os";

describe("aiTelemetryPlugin", () => {
  const createTestBuild = async (
    entryCode: string,
    pluginOptions?: Parameters<typeof aiTelemetryPlugin>[0]
  ) => {
    const tempDir = path.join(tmpdir(), `ai-telemetry-test-${Date.now()}`);
    const entryFile = path.join(tempDir, "entry.ts");
    const outfile = path.join(tempDir, "out.js");

    await import("fs/promises").then((fs) =>
      fs.mkdir(tempDir, { recursive: true })
    );
    await import("fs/promises").then((fs) =>
      fs.writeFile(entryFile, entryCode)
    );

    await esbuild.build({
      entryPoints: [entryFile],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [aiTelemetryPlugin(pluginOptions)],
      external: ["ai"],
    });

    const output = await readFile(outfile, "utf-8");
    await rm(tempDir, { recursive: true, force: true });
    return output;
  };

  test("wraps streamText with default telemetry config", async () => {
    const output = await createTestBuild(`
      import { streamText } from 'ai';
      streamText({ model: 'test' });
    `);

    expect(output).toContain("experimental_telemetry");
    expect(output).toContain('\"isEnabled\": true');
  });

  test("wraps generateText with default telemetry config", async () => {
    const output = await createTestBuild(`
      import { generateText } from 'ai';
      generateText({ model: 'test' });
    `);

    expect(output).toContain("experimental_telemetry");
    expect(output).toContain('\"isEnabled\": true');
  });

  test("preserves existing telemetry config when provided", async () => {
    const output = await createTestBuild(`
      import { streamText } from 'ai';
      streamText({ 
        model: 'test',
        experimental_telemetry: { isEnabled: false }
      });
    `);

    expect(output).toContain("experimental_telemetry");
    // Should use original function when telemetry is already provided
    expect(output).toContain(
      "if (!options || !options.experimental_telemetry)"
    );
  });

  test("supports custom telemetry config", async () => {
    const output = await createTestBuild(
      `
      import { streamText } from 'ai';
      streamText({ model: 'test' });
    `,
      {
        telemetryConfig: {
          isEnabled: true,
          recordInputs: false,
          functionId: "custom-fn",
        },
      }
    );

    expect(output).toContain('\"isEnabled\": true');
    expect(output).toContain('\"recordInputs\": false');
    expect(output).toContain('\"functionId\": \"custom-fn\"');
  });

  test("wraps multiple AI functions", async () => {
    const output = await createTestBuild(`
      import { streamText, generateText, generateObject } from 'ai';
      streamText({ model: 'test' });
      generateText({ model: 'test' });
      generateObject({ model: 'test' });
    `);

    expect(output).toContain("streamText");
    expect(output).toContain("generateText");
    expect(output).toContain("generateObject");
    expect(output).toContain('\"isEnabled\": true');
  });

  test("wraps only specified functions", async () => {
    const output = await createTestBuild(
      `
      import { streamText, generateText } from 'ai';
      streamText({ model: 'test' });
      generateText({ model: 'test' });
    `,
      {
        functions: ["streamText"],
      }
    );

    // streamText should be wrapped
    expect(output).toContain("streamText");
    // generateText should still be imported but not necessarily wrapped in the same way
    expect(output).toContain("generateText");
  });

  test("re-exports all ai package exports", async () => {
    const output = await createTestBuild(`
      import { streamText, generateText, generateObject, streamObject, embed, embedMany } from 'ai';
      streamText({ model: 'test' });
    `);

    // Should contain the re-export functionality (via __reExport)
    expect(output).toContain("__reExport");
  });

  test("handles namespace imports", async () => {
    const output = await createTestBuild(`
      import * as ai from 'ai';
      ai.streamText({ model: 'test' });
    `);

    expect(output).toContain("aiOriginal");
    expect(output).toContain("experimental_telemetry");
  });
});

describe("aiTelemetryPlugin - runtime behavior", () => {
  // Create a complete mock with all AI SDK functions to avoid warnings
  const createCompleteMockAi = (overrides: string = "") => `
    // Export all functions to avoid esbuild warnings
    export const streamText = (options) => ({ fn: 'streamText', options });
    export const generateText = (options) => ({ fn: 'generateText', options });
    export const generateObject = (options) => ({ fn: 'generateObject', options });
    export const streamObject = (options) => ({ fn: 'streamObject', options });
    export const embed = (options) => ({ fn: 'embed', options });
    export const embedMany = (options) => ({ fn: 'embedMany', options });
    ${overrides}
  `;

  const createAndExecuteBuild = async (
    entryCode: string,
    mockAiPackage: string,
    pluginOptions?: Parameters<typeof aiTelemetryPlugin>[0]
  ) => {
    const tempDir = path.join(tmpdir(), `ai-telemetry-exec-${Date.now()}`);
    const entryFile = path.join(tempDir, "entry.ts");
    const outfile = path.join(tempDir, "out.js");
    const aiMockDir = path.join(tempDir, "node_modules", "ai");
    const aiMockFile = path.join(aiMockDir, "index.js");

    await mkdir(tempDir, { recursive: true });
    await mkdir(aiMockDir, { recursive: true });
    await writeFile(entryFile, entryCode);
    await writeFile(aiMockFile, mockAiPackage);
    await writeFile(
      path.join(aiMockDir, "package.json"),
      JSON.stringify({ type: "module", main: "index.js" })
    );

    await esbuild.build({
      entryPoints: [entryFile],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [aiTelemetryPlugin(pluginOptions)],
    });

    // Import and execute the bundled code
    const module = await import(outfile);
    await rm(tempDir, { recursive: true, force: true });
    return module;
  };

  test("injects telemetry config when not provided", async () => {
    const result = await createAndExecuteBuild(
      `
      import { streamText } from 'ai';
      export const result = streamText({ model: 'test-model', prompt: 'hello' });
    `,
      createCompleteMockAi()
    );

    expect(result.result.options).toEqual({
      model: "test-model",
      prompt: "hello",
      experimental_telemetry: { isEnabled: true },
    });
  });

  test("preserves user-provided telemetry config", async () => {
    const result = await createAndExecuteBuild(
      `
      import { streamText } from 'ai';
      export const result = streamText({ 
        model: 'test-model',
        experimental_telemetry: { isEnabled: false, recordInputs: false }
      });
    `,
      createCompleteMockAi()
    );

    expect(result.result.options).toEqual({
      model: "test-model",
      experimental_telemetry: { isEnabled: false, recordInputs: false },
    });
  });

  test("injects custom telemetry config", async () => {
    const result = await createAndExecuteBuild(
      `
      import { generateText } from 'ai';
      export const result = generateText({ model: 'test-model' });
    `,
      createCompleteMockAi(),
      {
        telemetryConfig: {
          isEnabled: true,
          recordInputs: false,
          functionId: "my-function",
        },
      }
    );

    expect(result.result.options).toEqual({
      model: "test-model",
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        functionId: "my-function",
      },
    });
  });

  test("handles multiple function calls correctly", async () => {
    const result = await createAndExecuteBuild(
      `
      import { streamText, generateText } from 'ai';
      export const r1 = streamText({ model: 'm1' });
      export const r2 = generateText({ model: 'm2' });
    `,
      createCompleteMockAi()
    );

    expect(result.r1.fn).toBe("streamText");
    expect(result.r1.options.experimental_telemetry).toEqual({
      isEnabled: true,
    });
    expect(result.r2.fn).toBe("generateText");
    expect(result.r2.options.experimental_telemetry).toEqual({
      isEnabled: true,
    });
  });

  test("wraps only specified functions when configured", async () => {
    const result = await createAndExecuteBuild(
      `
      import { streamText, generateText } from 'ai';
      export const r1 = streamText({ model: 'm1' });
      export const r2 = generateText({ model: 'm2' });
    `,
      createCompleteMockAi(),
      { functions: ["streamText"] }
    );

    // streamText should have telemetry injected
    expect(result.r1.options.experimental_telemetry).toEqual({
      isEnabled: true,
    });
    // generateText should not (it's not in the wrapped functions list)
    expect(result.r2.options.experimental_telemetry).toBeUndefined();
  });

  test("handles options being undefined", async () => {
    const result = await createAndExecuteBuild(
      `
      import { streamText } from 'ai';
      export const result = streamText();
    `,
      createCompleteMockAi()
    );

    expect(result.result.options).toEqual({
      experimental_telemetry: { isEnabled: true },
    });
  });
});
