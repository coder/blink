import { spawn } from "child_process";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { join } from "path";
import { glob } from "glob";

let compileWorkerPromise: Promise<string> | undefined;

export async function compileWorker() {
  if (compileWorkerPromise) {
    return compileWorkerPromise;
  }
  compileWorkerPromise = (async () => {
    const workerDir = import.meta.dirname;
    const proc = spawn("bun", ["run", "build"], {
      cwd: workerDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const output: string[] = [];
    proc.stdout?.on("data", (data) => {
      output.push(Buffer.from(data).toString());
    });
    proc.stderr?.on("data", (data) => {
      output.push(Buffer.from(data).toString());
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      proc.on("exit", (code) => resolve(code ?? 0));
      proc.on("error", (err) => reject(err));
    });
    if (exitCode !== 0) {
      throw new Error(`Failed to build worker! Run \`bun run build\` to fix.

${output.join("\n")}`);
    }
    return join(workerDir, "dist", "index.js");
  })();
  return compileWorkerPromise;
}

export async function createMiniflare(
  options: Partial<MiniflareOptions>,
  scriptPath?: string
) {
  if (!scriptPath) {
    scriptPath = await compileWorker();
  }
  // Find all wasm files in the script directory.
  const wasmFiles = await glob("**/*.wasm", {
    cwd: join(scriptPath, ".."),
  });
  const modules = wasmFiles.map((path) => ({
    type: "CompiledWasm",
    path: join(scriptPath, "..", path),
  }));
  return new Miniflare({
    name: "blink-worker",
    compatibilityDate: "2025-05-05",
    compatibilityFlags: ["nodejs_compat"],
    ...options,
    modulesRoot: join(scriptPath, ".."),
    bindings: {
      // @ts-ignore
      ...(options.bindings ?? {}),
    },
    unsafeDirectSockets: [
      {
        host: "127.0.0.1",
        port: 0,
      },
    ],
    outboundService: {
      network: {
        allow: ["public", "127.0.0.0/8"],
        deny: [],
      },
    },
    // @ts-ignore
    modules: [
      {
        type: "ESModule",
        path: scriptPath,
      },
      ...modules,
    ],
  });
}

export async function createRemoteMiniflare(
  options: Partial<MiniflareOptions> = {}
): Promise<string> {
  const workerPath = await compileWorker();
  const blob = new Blob(
    [
      `
import { createMiniflare } from "@blink.so/worker/test";

self.onmessage = async (event) => {
    const instance = await createMiniflare(event.data.options, event.data.path);
    const url = await instance.unsafeGetDirectURL();
    self.postMessage({ url: url.toString() });
}
`,
    ],
    {
      type: "application/typescript",
    }
  );
  const worker = new Worker(URL.createObjectURL(blob));
  return new Promise<string>((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.url) {
        resolve(event.data.url.slice(0, -1));
      }
    };
    worker.onerror = (event) => {
      reject(event);
    };
    worker.postMessage({
      path: workerPath,
      options,
    });
  });
}

// The provided fn is stringified so local vars will not work.
// This is because Miniflare runs in the main thread, which blocks
// incoming HTTP server requests.
export const createWorkerHTTPServer = async <T = any>(
  fn: (req: Request, post: (msg: T) => void) => Promise<Response>
): Promise<{ url: string; postedMessage: () => Promise<T> }> => {
  const blob = new Blob(
    [
      `
let responseResolvers: Record<string, (response: Response) => void> = {}

self.onmessage = (event) => {
  if (event.data === "init") {
    const srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const fn = ${fn.toString()};
        const resp = await fn(req, (msg) => {
          setTimeout(() => {
            self.postMessage(msg)
          }, 1);
        })
        return resp
      },
    })
    const url = srv.url.toString()
    self.postMessage({ url });
    return
  }
}
    `,
    ],
    {
      type: "application/typescript",
    }
  );
  const worker = new Worker(URL.createObjectURL(blob));
  worker.postMessage("init");
  worker.onerror = (event) => {
    console.error("error", event);
  };

  let urlResolve: (url: string) => void;
  const urlPromise = new Promise<string>((resolve) => {
    urlResolve = resolve;
  });

  const queuedMessages: T[] = [];
  const queuedMessageResolvers: ((msg: T) => void)[] = [];

  worker.onmessage = (event) => {
    // Handle URL initialization message
    if (event.data.url) {
      // Trim the trailing slash.
      urlResolve(event.data.url.slice(0, -1));
      return;
    }

    // Handle regular messages
    if (queuedMessageResolvers.length > 0) {
      queuedMessageResolvers.shift()?.(event.data);
    } else {
      queuedMessages.push(event.data);
    }
  };

  const url = await urlPromise;
  return {
    url,
    postedMessage: () =>
      new Promise<T>((resolve) => {
        if (queuedMessages.length > 0) {
          resolve(queuedMessages.shift()!);
        } else {
          queuedMessageResolvers.push(resolve);
        }
      }),
  };
};
