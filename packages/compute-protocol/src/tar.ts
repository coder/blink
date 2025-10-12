import * as tarStream from "tar-stream";
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable as NodeReadable } from "node:stream";

export const createTarFromDirectory = async (
  path: string,
  opts?: { maxBytes?: number }
): Promise<ReadableStream<Uint8Array>> => {
  // Default to 50MB
  const { maxBytes = 50 * 1024 * 1024 } = opts ?? {};

  const stat = await fs.stat(path);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${path}`);
  }

  // Walk the directory tree and pack entries into a node stream using tar-stream
  const pack = tarStream.pack();

  const walk = async (dir: string, prefix: string = ""): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;
      const headerName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pack.entry({ name: `${headerName}/`, type: "directory" });
        await walk(fullPath, headerName);
        continue;
      }
      if (entry.isSymbolicLink?.()) {
        // Resolve symlink target
        const link = await fs.readlink(fullPath);
        pack.entry({ name: headerName, type: "symlink", linkname: link });
        continue;
      }
      if (entry.isFile()) {
        const fileStat = await fs.stat(fullPath);
        await new Promise<void>((resolve, reject) => {
          const fileStream = createReadStream(fullPath);
          const tarEntry = pack.entry(
            {
              name: headerName,
              size: fileStat.size,
              mode: fileStat.mode,
              mtime: fileStat.mtime,
            },
            (err) => {
              if (err) reject(err);
            }
          );
          fileStream.on("error", reject);
          fileStream.on("data", (chunk) => tarEntry.write(chunk));
          fileStream.on("end", () => {
            tarEntry.end();
            resolve();
          });
        });
        continue;
      }
    }
  };

  // Kick off the walk asynchronously; finalize pack when done
  (async () => {
    try {
      await walk(path);
      pack.finalize();
    } catch (err) {
      pack.destroy(err as Error);
    }
  })();

  // Convert Node readable to Web ReadableStream and enforce size limit
  const nodeReadable: NodeReadable = pack as unknown as NodeReadable;
  let emitted = 0;
  let ended = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onData = (chunk: Buffer) => {
        if (ended) return;
        emitted += chunk.length;
        if (emitted > maxBytes) {
          ended = true;
          controller.error(
            new Error(
              `Archive exceeds size limit (${maxBytes} bytes). Emitted=${emitted} bytes.`
            )
          );
          try {
            nodeReadable.destroy();
          } catch {}
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
      };
      const onError = (err: unknown) => {
        if (ended) return;
        ended = true;
        controller.error(err instanceof Error ? err : new Error(String(err)));
      };
      const onEnd = () => {
        if (ended) return;
        ended = true;
        controller.close();
      };
      nodeReadable.on("data", onData);
      nodeReadable.once("error", onError);
      nodeReadable.once("end", onEnd);
    },
    cancel() {
      try {
        nodeReadable.destroy();
      } catch {}
    },
  });
};
