import { createServer } from "http";
import { useEffect, useMemo, useRef, useState } from "react";
import { Client } from "../agent/client";
import { createEditAgent, type EditAgent } from "../edit/agent";

export interface UseEditAgentOptions {
  readonly directory: string;
  readonly apiServerUrl?: string;
  readonly token?: string;
  readonly getDevhookUrl: () => string;
}

export default function useEditAgent(options: UseEditAgentOptions) {
  const [client, setClient] = useState<Client | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const editAgentRef = useRef<EditAgent | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let isCleanup = false;

    // Clear error at the start - attempting to create edit agent
    setError(undefined);
    setClient(undefined);

    (async () => {
      // Create the edit agent
      editAgentRef.current = createEditAgent({
        directory: options.directory,
        token: options.token,
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

      setClient(editClient);
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
  }, [
    options.directory,
    options.apiServerUrl,
    options.token,
    options.getDevhookUrl,
  ]);

  return useMemo(() => {
    return {
      client,
      error,
      setUserAgentUrl: (url: string) => {
        editAgentRef.current?.setUserAgentUrl(url);
      },
    };
  }, [client, error]);
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
