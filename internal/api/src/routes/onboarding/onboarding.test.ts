import { afterAll, beforeAll, expect, test } from "bun:test";
import { createGzip } from "node:zlib";
import * as tarStream from "tar-stream";
import { serve } from "../../test";

// Helper to create a tar.gz buffer in memory
async function createMockTarGz(
  files: Array<{ path: string; content: string }>
): Promise<Buffer> {
  const pack = tarStream.pack();

  for (const file of files) {
    pack.entry({ name: file.path }, file.content);
  }
  pack.finalize();

  // Collect tar data
  const tarChunks: Buffer[] = [];
  for await (const chunk of pack as unknown as AsyncIterable<Buffer>) {
    tarChunks.push(chunk);
  }
  const tarBuffer = Buffer.concat(tarChunks);

  // Gzip the tar data
  return new Promise((resolve, reject) => {
    const gzip = createGzip();
    const gzipChunks: Buffer[] = [];

    gzip.on("data", (chunk: Buffer) => gzipChunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(gzipChunks)));
    gzip.on("error", reject);

    gzip.end(tarBuffer);
  });
}

// Mock bundle server
let mockBundleServer: ReturnType<typeof Bun.serve> | null = null;
let mockBundleUrl: string = "";

beforeAll(async () => {
  // Create mock tar.gz with test files
  const mockTarGz = await createMockTarGz([
    // Output files (in .blink/build/)
    { path: ".blink/build/agent.js", content: 'console.log("Hello agent");' },
    { path: ".blink/build/package.json", content: '{"type": "module"}' },
    // Source files
    { path: "agent.ts", content: 'export const agent = "test";' },
    { path: "package.json", content: '{"name": "test-agent"}' },
    { path: "tsconfig.json", content: '{"compilerOptions": {}}' },
    { path: "README.md", content: "# Test Agent" },
    // Files to skip
    { path: ".blink/config.json", content: '{"agentId": "123"}' },
  ]);

  mockBundleServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      // Simulate redirect like artifacts.blink.host does
      if (url.pathname === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: { Location: `${mockBundleUrl}/bundle.tar.gz` },
        });
      }

      if (url.pathname === "/bundle.tar.gz") {
        return new Response(new Uint8Array(mockTarGz), {
          headers: { "Content-Type": "application/gzip" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  mockBundleUrl = mockBundleServer.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  mockBundleServer?.stop();
});

test("POST /api/onboarding/download-agent extracts tar.gz and categorizes files", async () => {
  const { helpers, stop } = await serve({
    bindings: {
      ONBOARDING_AGENT_BUNDLE_URL: `${mockBundleUrl}/bundle.tar.gz`,
    },
  });

  try {
    const { client } = await helpers.createUser();

    // Create an organization for the user
    const org = await client.organizations.create({
      name: "test-org",
    });

    // Call the download-agent endpoint
    const result = await client.onboarding.downloadAgent({
      organization_id: org.id,
    });

    // Verify output files (from .blink/build/)
    expect(result.output_files).toBeArrayOfSize(2);
    expect(result.output_files.map((f) => f.path).sort()).toEqual([
      "agent.js",
      "package.json",
    ]);

    // Verify source files (everything except .blink/)
    expect(result.source_files).toBeArrayOfSize(4);
    expect(result.source_files.map((f) => f.path).sort()).toEqual([
      "README.md",
      "agent.ts",
      "package.json",
      "tsconfig.json",
    ]);

    // Verify entrypoint
    expect(result.entrypoint).toBe("agent.js");

    // Verify all files have valid UUIDs
    for (const file of [...result.output_files, ...result.source_files]) {
      expect(file.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  } finally {
    stop();
  }
});

test("POST /api/onboarding/download-agent follows redirects", async () => {
  const { helpers, stop } = await serve({
    bindings: {
      // Use the redirect endpoint
      ONBOARDING_AGENT_BUNDLE_URL: `${mockBundleUrl}/redirect`,
    },
  });

  try {
    const { client } = await helpers.createUser();

    const org = await client.organizations.create({
      name: "test-org-redirect",
    });

    const result = await client.onboarding.downloadAgent({
      organization_id: org.id,
    });

    // Should still work after following redirect
    expect(result.output_files.length).toBeGreaterThan(0);
    expect(result.source_files.length).toBeGreaterThan(0);
    expect(result.entrypoint).toBe("agent.js");
  } finally {
    stop();
  }
});

test("POST /api/onboarding/download-agent returns 502 on download failure", async () => {
  const { helpers, stop } = await serve({
    bindings: {
      ONBOARDING_AGENT_BUNDLE_URL: `${mockBundleUrl}/nonexistent`,
    },
  });

  try {
    const { client } = await helpers.createUser();

    const org = await client.organizations.create({
      name: "test-org-error",
    });

    await expect(
      client.onboarding.downloadAgent({
        organization_id: org.id,
      })
    ).rejects.toThrow();
  } finally {
    stop();
  }
});

test("POST /api/onboarding/download-agent includes server version in User-Agent", async () => {
  const captured: { userAgent?: string } = {};

  // Create a mock server that captures the User-Agent header
  const mockTarGz = await createMockTarGz([
    { path: ".blink/build/agent.js", content: "test" },
    { path: "agent.ts", content: "test" },
  ]);

  const userAgentServer = Bun.serve({
    port: 0,
    fetch(req) {
      captured.userAgent = req.headers.get("User-Agent") ?? undefined;
      return new Response(new Uint8Array(mockTarGz), {
        headers: { "Content-Type": "application/gzip" },
      });
    },
  });

  const { helpers, stop } = await serve({
    bindings: {
      ONBOARDING_AGENT_BUNDLE_URL: `${userAgentServer.url}bundle.tar.gz`,
      serverVersion: "custom-version",
    },
  });

  try {
    const { client } = await helpers.createUser();

    const org = await client.organizations.create({
      name: "test-org-user-agent",
    });

    await client.onboarding.downloadAgent({
      organization_id: org.id,
    });

    expect(captured.userAgent).toBe("Blink-Server/custom-version");
  } finally {
    stop();
    userAgentServer.stop();
  }
});
