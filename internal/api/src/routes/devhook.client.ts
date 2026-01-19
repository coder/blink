import type { Disposable } from "@blink-sdk/events";
import { z } from "zod";
import type Client from "../client.node";
import { assertResponseStatus } from "../client-helper";

export interface DevhookListenOptions {
  readonly id: string;

  readonly onRequest: (req: Request) => Promise<Response>;
  readonly onConnect?: () => void;
  readonly onDisconnect?: () => void;
  readonly onError?: (error: unknown) => void;
}

export const schemaDevhookUrlResponse = z.object({
  url: z.string(),
});

export type DevhookUrlResponse = z.infer<typeof schemaDevhookUrlResponse>;

export default class Devhook {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  public async getUrl(id: string): Promise<string> {
    if (!id) {
      throw new Error("Devhook ID is required");
    }

    const response = await this.client.request("GET", `/api/devhook/${id}/url`);
    await assertResponseStatus(response, 200);
    const payload = schemaDevhookUrlResponse.parse(await response.json());
    return payload.url;
  }

  public listen(options: DevhookListenOptions): Disposable {
    let socket: WebSocket | undefined;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    // Exponential backoff with jitter
    const baseDelayMS = 250;
    const maxDelayMS = 10_000;
    let currentDelayMS = baseDelayMS;

    const clearReconnectTimer = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      clearReconnectTimer();
      const jitter = currentDelayMS * 0.2 * Math.random();
      const delay = Math.min(maxDelayMS, Math.floor(currentDelayMS + jitter));
      reconnectTimeout = setTimeout(() => {
        openSocket();
      }, delay);
      currentDelayMS = Math.min(maxDelayMS, Math.floor(currentDelayMS * 1.5));
    };

    const resetBackoff = () => {
      currentDelayMS = baseDelayMS;
    };

    // This is an optional dependency, so we need to require it
    // here instead of above. It's optional because using the
    // compute protocol is nice, but it takes up a lot of space in the bundle.
    const { Server } =
      require("@blink-sdk/compute-protocol/server") as typeof import("@blink-sdk/compute-protocol/server");

    const server = new Server({
      send: (data) => {
        const ws = socket;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          // If the socket disconnects mid-request, we'll have problems right now.
          return;
        }
        ws.send(data);
      },
      fetchProxyRequest(url, init) {
        return options.onRequest(
          new Request(url, {
            ...init,
            // @ts-expect-error - This is required for NodeJS:
            // https://github.com/nodejs/node/issues/46221
            duplex: init.body ? "half" : undefined,
          })
        );
      },
    });

    const toUint8Array = (data: unknown): Uint8Array | undefined => {
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
        return new Uint8Array(data);
      }
      return undefined;
    };

    const attachListeners = (ws: WebSocket) => {
      ws.binaryType = "arraybuffer";

      ws.addEventListener("open", () => {
        if (disposed) return;
        resetBackoff();
        options.onConnect?.();
      });

      ws.addEventListener("close", () => {
        if (disposed) return;
        options.onDisconnect?.();
        scheduleReconnect();
      });

      ws.addEventListener("error", (err) => {
        try {
          options.onError?.(err);
        } catch {}
        // Ensure we eventually reconnect; some environments may not emit close.
        try {
          ws.close();
        } catch {}
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          console.warn("Message skipped because it is not a buffer.");
          return;
        }
        try {
          const payload = toUint8Array(event.data);
          if (!payload) {
            console.warn("Message skipped because it is not a buffer.");
            return;
          }
          server.handleMessage(payload);
        } catch (err) {
          console.error("message handler error", err);
          try {
            ws.close(1011);
          } catch {}
        }
      });
    };

    const openSocket = () => {
      if (disposed) return;
      try {
        const ws = this.client.websocket(`/api/devhook/${options.id}`);
        socket = ws;
        attachListeners(ws);
      } catch (err) {
        // If construction itself fails, surface error and retry
        try {
          options.onError?.(err);
        } catch {}
        scheduleReconnect();
      }
    };

    openSocket();

    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        clearReconnectTimer();
        const ws = socket;
        socket = undefined;
        try {
          if (
            ws &&
            (ws.readyState === WebSocket.OPEN ||
              ws.readyState === WebSocket.CONNECTING)
          ) {
            ws.close(1000);
          }
        } catch {}
      },
    };
  }
}
