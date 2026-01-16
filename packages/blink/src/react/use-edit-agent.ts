import { createServer } from "http";
import { useEffect, useMemo, useRef, useState } from "react";
import { Client } from "../agent/client";
import {
  createEditAgent,
  getEditModeModel,
  type EditAgent,
} from "../edit/agent";
import { RWLock } from "../local/rw-lock";

export interface UseEditAgentOptions {
  readonly directory: string;
  readonly apiServerUrl?: string;
  readonly env: Record<string, string>;
  readonly getDevhookUrl: () => Promise<string>;
}

interface ClientAndLock {
  readonly client: Client;
  readonly lock: RWLock;
}

export default function useEditAgent(options: UseEditAgentOptions) {
  const [clientAndLock, setClientAndLock] = useState<ClientAndLock | undefined>(
    undefined
  );
  const [error, setError] = useState<Error | undefined>(undefined);
  const [missingApiKey, setMissingApiKey] = useState(false);
  const editAgentRef = useRef<EditAgent | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let isCleanup = false;

    // Clear error at the start - attempting to create edit agent
    setError(undefined);
    setClientAndLock(undefined);

    if (!getEditModeModel(options.env)) {
      setMissingApiKey(true);
      return; // Don't create agent
    }

    setMissingApiKey(false);

    let lock: RWLock | undefined;

    (async () => {
      // Create the edit agent
      editAgentRef.current = createEditAgent({
        directory: options.directory,
        env: options.env,
        getDevhookUrl: options.getDevhookUrl,
      });

      // Get a random port
      const port = await getRandomPort();

      // Serve the agent
      const server = editAgentRef.current.agent.serve({
        port,
        host: "127.0.0.1",
        apiUrl: options.apiServerUrl,
      });

      controller.signal.addEventListener("abort", () => {
        try {
          server.close();
        } catch {}
        editAgentRef.current?.cleanup();
      });

      // Create a client for the edit agent
      const editClient = new Client({
        baseUrl: `http://127.0.0.1:${port}`,
      });
      const editAgentLock = new RWLock();
      lock = editAgentLock;

      // Wait for health check
      while (!controller.signal.aborted) {
        try {
          await editClient.health();
          break;
        } catch (err) {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (controller.signal.aborted) {
        throw controller.signal.reason;
      }

      setClientAndLock({ client: editClient, lock: editAgentLock });
    })().catch((err) => {
      // Don't set error if this was just a cleanup abort
      if (!isCleanup) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return () => {
      isCleanup = true;
      (async () => {
        // Acquire write lock before cleaning up this edit agent instance
        // This waits for any active streams using this agent to complete
        using _writeLock = await lock?.write();
        controller.abort();
      })();
    };
  }, [
    options.directory,
    options.apiServerUrl,
    options.env,
    options.getDevhookUrl,
  ]);

  return useMemo(() => {
    return {
      agent: clientAndLock,
      error,
      missingApiKey,
      setUserAgentUrl: (url: string) => {
        editAgentRef.current?.setUserAgentUrl(url);
      },
    };
  }, [clientAndLock, error, missingApiKey]);
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
