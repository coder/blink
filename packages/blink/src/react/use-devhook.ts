import Client from "@blink.so/api";
import { useEffect, useRef, useState } from "react";
import { lock } from "proper-lockfile";
import { join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import chalk from "chalk";

export interface UseDevhookOptions {
  // ID can optionally be provided to identify the devhook.
  // If not specified, a value is loaded from the local storage.
  readonly id?: string;
  readonly disabled?: boolean;
  readonly onRequest: (request: Request) => Promise<Response>;
  readonly directory: string;
}

export default function useDevhook(options: UseDevhookOptions) {
  const onRequestRef = useRef(options.onRequest);
  useEffect(() => {
    onRequestRef.current = options.onRequest;
  }, [options.onRequest]);
  const id = useRef<string>(options.id ?? crypto.randomUUID());
  const [status, setStatus] = useState<"connected" | "disconnected" | "error">(
    "disconnected"
  );

  useEffect(() => {
    if (options.disabled) {
      setStatus("disconnected");
      return;
    }

    let disposed = false;
    let currentListener: any;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let isConnecting = false;
    let releaseLock: (() => Promise<void>) | undefined;

    const lockPath = join(options.directory, "data", "devhook.lock");
    const pidPath = join(options.directory, "data", "devhook.pid");

    // Acquire lock before connecting
    (async () => {
      try {
        releaseLock = await lock(lockPath, {
          stale: 10000,
          retries: 0,
          realpath: false,
        });

        // Write our PID to a file so other processes can identify us
        writeFileSync(pidPath, process.pid.toString(), "utf-8");
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
            if (existsSync(pidPath)) {
              const pid = readFileSync(pidPath, "utf-8").trim();
              pidMessage = ` (PID: ${pid})`;
            }
          } catch {
            // Ignore errors reading PID file
          }

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
        console.warn(
          chalk.yellow(`\nWarning: Failed to acquire devhook lock: ${message}`)
        );
        console.warn(
          chalk.yellow(
            `Continuing without lock. Multiple ${chalk.bold("blink dev")} processes may conflict with each other.\n`
          )
        );
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

        // No authentication needed for devhooks.
        const client = new Client({
          // TODO: This shouldn't be hardcoded but our @blink.so/api package
          // currently uses `BLINK_API_URL` which this does too 🤦🤦🤦.
          baseURL: "https://blink.so",
        });
        currentListener = client.devhook.listen({
          id: id.current,
          onRequest: async (request) => {
            return onRequestRef.current(request);
          },
          onConnect: () => {
            isConnecting = false;
            setStatus("connected");
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
        releaseLock().catch((err) => {
          console.warn("Failed to release devhook lock:", err);
        });
        // Clean up PID file only if we successfully acquired the lock
        try {
          if (existsSync(pidPath)) {
            unlinkSync(pidPath);
          }
        } catch (_err) {
          // Ignore errors cleaning up PID file
        }
      }
    };
  }, [options.disabled, options.directory]);

  return {
    id: id.current,
    status,
  };
}
