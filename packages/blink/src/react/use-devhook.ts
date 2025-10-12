import Client from "@blink.so/api";
import { useEffect, useRef, useState } from "react";

export interface UseDevhookOptions {
  // ID can optionally be provided to identify the devhook.
  // If not specified, a value is loaded from the local storage.
  readonly id?: string;
  readonly disabled?: boolean;
  readonly onRequest: (request: Request) => Promise<Response>;
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

    const connect = () => {
      if (disposed || isConnecting) return;
      isConnecting = true;

      // Clean up any existing listener before creating a new one
      if (currentListener) {
        try {
          // @ts-ignore
          currentListener.dispose();
        } catch (err) {
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
        onError: (error) => {
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
        } catch (err) {
          // Ignore disposal errors
        }
        currentListener = undefined;
      }
    };
  }, [options.disabled]);

  return {
    id: id.current,
    status,
  };
}
