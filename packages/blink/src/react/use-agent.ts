import { spawn } from "child_process";
import { createServer } from "http";
import { useEffect, useMemo, useState } from "react";
import type { BuildResult } from "../build";
import {
  Client,
  type CapabilitiesResponse,
  APIServerURLEnvironmentVariable,
} from "../agent/client";

export interface AgentLog {
  readonly level: "log" | "error";
  readonly message: string;
}

export interface UseAgentOptions {
  readonly buildResult?: BuildResult;
  readonly env?: Record<string, string>;
  readonly apiServerUrl?: string;
}

// useAgent is a hook that provides a client for an agent at the given entrypoint.
export default function useAgent(options: UseAgentOptions) {
  const [agent, setAgent] = useState<Client | undefined>(undefined);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [buildResult, setBuildResult] = useState(options.buildResult);
  const [env, setEnv] = useState(options.env);
  const [apiServerUrl, setApiServerUrl] = useState(options.apiServerUrl);
  const [capabilities, setCapabilities] = useState<
    CapabilitiesResponse | undefined
  >(undefined);
  useEffect(() => {
    setEnv(options.env);
    setBuildResult(options.buildResult);
    setApiServerUrl(options.apiServerUrl);
  }, [options.env, options.buildResult, options.apiServerUrl]);

  useEffect(() => {
    if (!buildResult || "error" in buildResult) {
      setAgent(undefined);
      setLogs([]);
      // Clear error when no build result - waiting for build
      setError(undefined);
      setCapabilities(undefined);
      return;
    }
    const controller = new AbortController();
    let isCleanup = false;

    // Clear error and state at the start - new build is ready
    setError(undefined);
    setAgent(undefined);
    setCapabilities(undefined);

    (async () => {
      const port = await getRandomPort();
      const proc = spawn("node", ["--no-deprecation", buildResult.entry], {
        stdio: "pipe",
        env: {
          ...process.env,
          ...env,
          [APIServerURLEnvironmentVariable]: apiServerUrl,
          PORT: port.toString(),
          HOST: "127.0.0.1",
        },
      });
      controller.signal.addEventListener("abort", () => {
        try {
          proc.kill();
        } catch {}
      });
      let ready = false;
      proc.stdout.on("data", (data) => {
        const msg = Buffer.from(data).toString("utf-8").trim();
        // Hide the listening message. This is just a nicety for the user.
        if (!ready && msg.startsWith("Agent server listening on")) {
          return;
        }
        if (!ready) {
          console.log(`stdout: ${msg}`);
        }
        if (msg.length) {
          setLogs((prev) => [...prev, { level: "log", message: msg }]);
        }
      });
      proc.stderr.on("data", (data) => {
        if (!ready) {
          console.error(
            `stderr: ${Buffer.from(data).toString("utf-8").trim()}`
          );
        }
        const msg = Buffer.from(data).toString("utf-8").trim();
        if (msg.length) {
          setLogs((prev) => [
            ...prev,
            {
              level: "error",
              message: msg,
            },
          ]);
        }
      });
      proc.on("error", (err) => {
        controller.abort(err);
      });
      proc.on("exit", (code, signal) => {
        controller.abort(
          `Agent exited with code ${code ?? "unknown"} and signal ${
            signal ?? "unknown"
          }. Be sure to call "blink.agent(...).serve()".`
        );
      });
      const client = new Client({
        baseUrl: `http://127.0.0.1:${port}`,
      });
      // Wait for the health endpoint to be alive.
      while (!controller.signal.aborted) {
        try {
          await client.health();
          break;
        } catch (err) {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (controller.signal.aborted) {
        throw controller.signal.reason;
      }

      ready = true;
      const capabilities = await client.capabilities();
      setCapabilities(capabilities);
      setAgent(client);
    })().catch((err) => {
      // Don't set error if this was just a cleanup abort
      if (!isCleanup) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return () => {
      isCleanup = true;
      controller.abort();
    };
  }, [buildResult, env, apiServerUrl]);

  return useMemo(() => {
    return {
      agent,
      logs,
      error,
      capabilities,
    };
  }, [agent, logs, error, capabilities]);
}

async function getRandomPort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server
      .listen(0, () => {
        // @ts-expect-error
        const port = server.address().port;
        resolve(port);
      })
      .on("error", (err) => {
        reject(err);
      });
  }).finally(() => {
    server.close();
  });
}
