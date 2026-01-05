import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import * as tarStream from "tar-stream";
import { authorizeOrganization, withAuth } from "../../middleware";
import type { Bindings } from "../../server";
import { schemaDownloadAgentRequest } from "./onboarding.client";

export default function mountOnboarding(app: Hono<{ Bindings: Bindings }>) {
  // Download the onboarding agent bundle from artifacts server
  app.post(
    "/download-agent",
    withAuth,
    validator("json", (value) => {
      return schemaDownloadAgentRequest.parse(value);
    }),
    async (c) => {
      const req = c.req.valid("json");
      await authorizeOrganization(c, req.organization_id);

      const bundleUrl = c.env.ONBOARDING_AGENT_BUNDLE_URL;

      // Fetch the tar.gz bundle (follows redirects by default)
      const bundleResp = await fetch(bundleUrl, {
        headers: {
          "User-Agent": `Blink-Server/${c.env.serverVersion}`,
        },
        redirect: "follow",
      });
      if (!bundleResp.ok) {
        throw new HTTPException(502, {
          message: `Failed to download bundle: ${bundleResp.status}`,
        });
      }

      // Extract tar.gz and collect files
      const files = await extractTarGz(bundleResp);

      // Categorize files
      const outputFilesToUpload: Array<{ path: string; data: Buffer }> = [];
      const sourceFilesToUpload: Array<{ path: string; data: Buffer }> = [];

      for (const file of files) {
        // Skip the bundle.tar.gz if it's inside the archive
        if (file.path === "bundle.tar.gz") {
          continue;
        }

        // Files under .blink/build/ are output files
        if (file.path.startsWith(".blink/build/")) {
          const outputPath = file.path.replace(".blink/build/", "");
          outputFilesToUpload.push({ path: outputPath, data: file.data });
        }
        // Skip other .blink/ files (like .blink/config.json)
        else if (file.path.startsWith(".blink/")) {
          // Skip
        }
        // Everything else is a source file
        else {
          sourceFilesToUpload.push({ path: file.path, data: file.data });
        }
      }

      // Upload all files in parallel
      const userId = c.get("user_id");

      const [outputFiles, sourceFiles] = await Promise.all([
        Promise.all(
          outputFilesToUpload.map(async (file) => {
            const { id } = await c.env.files.upload({
              user_id: userId,
              organization_id: req.organization_id,
              file: new File([new Uint8Array(file.data)], file.path),
            });
            return { path: file.path, id };
          })
        ),
        Promise.all(
          sourceFilesToUpload.map(async (file) => {
            const { id } = await c.env.files.upload({
              user_id: userId,
              organization_id: req.organization_id,
              file: new File([new Uint8Array(file.data)], file.path),
            });
            return { path: file.path, id };
          })
        ),
      ]);

      return c.json({
        output_files: outputFiles,
        source_files: sourceFiles,
        entrypoint: "agent.js",
      });
    }
  );
}

interface ExtractedFile {
  path: string;
  data: Buffer;
}

async function extractTarGz(response: Response): Promise<ExtractedFile[]> {
  const files: ExtractedFile[] = [];

  // Get response body as array buffer and convert to Node stream
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const nodeStream = Readable.from(buffer);

  // Create gunzip and tar extract streams
  const gunzip = createGunzip();
  const extract = tarStream.extract();

  return new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      // Only process regular files
      if (header.type !== "file") {
        stream.resume();
        next();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        files.push({
          path: header.name,
          data: Buffer.concat(chunks),
        });
        next();
      });
      stream.on("error", reject);
    });

    extract.on("finish", () => resolve(files));
    extract.on("error", reject);

    gunzip.on("error", reject);

    // Pipe: buffer -> gunzip -> tar extract
    nodeStream.pipe(gunzip).pipe(extract);
  });
}
