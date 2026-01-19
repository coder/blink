import Client from "@blink.so/api";
import { useEffect, useRef, useState } from "react";
import { lock, getLockInfo } from "../local/lockfile";
import { join } from "node:path";
import chalk from "chalk";
import { getHost } from "../cli/lib/auth";
import type { Logger } from "./use-logger";
import { getAuthToken } from "../cli/lib/auth";

export interface UseDevhookOptions {
  // ID can optionally be provided to identify the devhook.
  // If not specified, a value is loaded from the local storage.
  readonly id?: string;
  readonly disabled?: boolean;
  readonly onRequest: (request: Request) => Promise<Response>;
  readonly directory: string;
  readonly logger: Logger;
}

export default function useDevhook(options: UseDevhookOptions) {
  const onRequestRef = useRef(options.onRequest);
  useEffect(() => {
    onRequestRef.current = options.onRequest;
  }, [options.onRequest]);

  const [status, setStatus] = useState<"connected" | "disconnected" | "error">(
    "disconnected"
  );
  const [publicUrl, setPublicUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!options.id) {
      setPublicUrl(undefined);
      return;
    }
    const host = getHost();
    const token = getAuthToken();
    if (!host || !token) {
      // Skip URL lookup if not logged in
      setPublicUrl(undefined);
      return;
    }
    let cancelled = false;
    setPublicUrl(undefined);
    const client = new Client({ baseURL: host, authToken: token });
    void client.devhook
      .getUrl(options.id)
      .then((url) => {
        if (!cancelled) {
          setPublicUrl(url);
        }
      })
      .catch(() => {
        // Ignore lookup errors; listener will retry on connect.
      });
    return () => {
      cancelled = true;
    };
  }, [options.id]);

  useEffect(() => {
    // Don't connect if disabled or no devhook ID exists
    if (options.disabled || !options.id) {
      setStatus("disconnected");
      return;
    }

    let disposed = false;
    let currentListener: any;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let isConnecting = false;
    let releaseLock: (() => void) | undefined;

    const lockPath = join(options.directory, ".blink", "devhook");

    // Acquire lock before connecting
    (async () => {
      try {
        releaseLock = await lock(lockPath, {
          stale: true,
          retries: 0,
        });
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          err.code === "ELOCKED"
        ) {
          // Try to read the PID of the process holding the lock
          let pidMessage = "";
          try {
            const lockInfo = getLockInfo(lockPath);
            if (lockInfo.locked && lockInfo.pid) {
              pidMessage = ` (PID: ${lockInfo.pid})`;
            }
          } catch {
            // Ignore errors reading lock info
          }

          // don't use logger since it's not guaranteed to print before exiting
          console.error(
            chalk.red(
              `\nError: Another ${chalk.bold("blink dev")} process is already running in this directory${pidMessage}.`
            )
          );
          console.error(
            chalk.red(`Please stop the other process and try again.\n`)
          );
          process.exit(1);
        }

        // For other errors (filesystem issues, permissions, etc.), warn and continue
        const message =
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err);
        options.logger.error(
          "system",
          chalk.yellow(`\nWarning: Failed to acquire devhook lock: ${message}`)
        );
        options.logger.error(
          "system",
          chalk.yellow(
            `Continuing without lock. Multiple ${chalk.bold("blink dev")} processes may conflict with each other.\n`
          )
        );
      }

      // Check if user is logged in before connecting
      const host = getHost();
      const token = getAuthToken();
      if (!host || !token) {
        options.logger.log(
          "system",
          `Run ${chalk.bold("blink login")} to send webhooks to your agent from anywhere`
        );
        return;
      }

      // Lock acquired, now connect
      const connect = () => {
        if (disposed || isConnecting) return;
        isConnecting = true;

        // Clean up any existing listener before creating a new one
        if (currentListener) {
          try {
            // @ts-ignore
            currentListener.dispose();
          } catch (_err) {
            // Ignore disposal errors
          }
          currentListener = undefined;
        }

        const client = new Client({ baseURL: host, authToken: token });
        currentListener = client.devhook.listen({
          id: options.id!,
          onRequest: async (request) => {
            return onRequestRef.current(request);
          },
          onConnect: () => {
            void (async () => {
              const url = await client.devhook.getUrl(options.id!);
              isConnecting = false;
              setStatus("connected");
              setPublicUrl(url);
            })();
          },
          onDisconnect: () => {
            isConnecting = false;
            setStatus("disconnected");
            // Reconnect after a delay if not manually disposed
            if (!disposed && !reconnectTimer) {
              reconnectTimer = setTimeout(() => {
                reconnectTimer = undefined;
                connect();
              }, 2000);
            }
          },
          onError: (_error) => {
            isConnecting = false;
            setStatus("error");
            // Reconnect after a delay on error as well
            if (!disposed && !reconnectTimer) {
              reconnectTimer = setTimeout(() => {
                reconnectTimer = undefined;
                connect();
              }, 2000);
            }
          },
        });
      };

      connect();
    })();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (currentListener) {
        try {
          // @ts-ignore
          currentListener.dispose();
        } catch (_err) {
          // Ignore disposal errors
        }
        currentListener = undefined;
      }
      if (releaseLock) {
        try {
          releaseLock();
        } catch (err) {
          options.logger.error(
            "system",
            "Failed to release devhook lock:",
            err
          );
        }
      }
    };
  }, [options.disabled, options.directory, options.id]);

  return {
    id: options.id,
    url: publicUrl,
    status,
  };
}
