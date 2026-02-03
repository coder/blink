import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Worker as DevhookWorker } from "@blink.so/compute-protocol-worker";
import type Querier from "@blink.so/database/querier";
import { validate as uuidValidate } from "uuid";
import { WebSocket, WebSocketServer } from "ws";
import { getAccessUrlBase } from "../../../internal/api/src/server-helper";

type DevhookSession = {
  id: string;
  ws: WebSocket;
  worker: DevhookWorker;
};

export interface DevhookSupport {
  matchRequestHost?: (host: string) => string | undefined;
  createRequestURL?: (id: string) => URL;
  handleUpgrade: (
    id: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) => Promise<void>;
  handleRequest: (id: string, req: Request) => Promise<Response>;
  handleListen: (id: string, req: Request) => Promise<Response>;
}

export const createDevhookSupport = (opts: {
  accessUrl: string;
  wildcardAccessUrl?: string;
  querier: Querier;
}): DevhookSupport => {
  const devhookWss = new WebSocketServer({ noServer: true });
  const devhookSessions = new Map<string, DevhookSession>();
  const accessUrl = new URL(opts.accessUrl);
  const wildcard = parseWildcardAccessUrl(
    opts.wildcardAccessUrl,
    accessUrl.protocol
  );

  const isValidRequestId = (value: string): boolean => {
    return uuidValidate(value);
  };

  const getHostname = (host: string): string => {
    try {
      return new URL(`http://${host}`).hostname;
    } catch {
      return host;
    }
  };

  const matchRequestHost = wildcard
    ? (host: string): string | undefined => {
        const hostname = getHostname(host);
        if (!hostname || hostname === wildcard.baseHost) {
          return undefined;
        }
        if (!hostname.endsWith(`.${wildcard.baseHost}`)) {
          return undefined;
        }
        const id = hostname.slice(0, -(wildcard.baseHost.length + 1));
        if (!isValidRequestId(id)) {
          return undefined;
        }
        return id;
      }
    : undefined;

  const createRequestURL = wildcard
    ? (id: string): URL => {
        const url = new URL(wildcard.baseUrl.toString());
        url.hostname = `${id}.${wildcard.baseHost}`;
        return url;
      }
    : (id: string): URL => {
        const baseUrl = getAccessUrlBase(accessUrl);
        return new URL(`api/webhook/${id}/`, baseUrl);
      };

  const toUint8Array = (data: WebSocket.RawData): Uint8Array => {
    if (Array.isArray(data)) {
      return new Uint8Array(Buffer.concat(data));
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (Buffer.isBuffer(data)) {
      return new Uint8Array(data);
    }
    return new Uint8Array(data as Buffer);
  };

  const handleUpgrade = async (
    id: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) => {
    if (!isValidRequestId(id)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const existing = await opts.querier.selectAgentDeploymentByRequestID(id);
      if (existing) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch (error) {
      console.error("Devhook lookup error:", error);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      return;
    }

    devhookWss.handleUpgrade(request, socket, head, (ws) => {
      const existingSession = devhookSessions.get(id);
      if (existingSession?.ws?.readyState === WebSocket.OPEN) {
        try {
          existingSession.ws.close(1000, "A new client has connected.");
        } catch {
          // Ignore close errors
        }
      }

      const worker = new DevhookWorker({
        sendToClient: (_streamId, _message) => {
          // noop - devhooks only proxy requests
        },
        sendToServer: (message) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        },
      });

      const session: DevhookSession = { id, ws, worker };
      devhookSessions.set(id, session);

      ws.on("message", (data, isBinary) => {
        if (!isBinary) {
          // Close with 1003 (Unsupported Data) for text frames
          ws.close(1003, "Only binary frames are supported");
          return;
        }
        worker.handleServerMessage(toUint8Array(data));
      });

      ws.on("close", () => {
        const current = devhookSessions.get(id);
        if (current?.ws === ws) {
          devhookSessions.delete(id);
        }
      });

      ws.on("error", () => {
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      });
    });
  };

  const handleRequest = async (id: string, req: Request): Promise<Response> => {
    // Reject upgrade requests before proxying to avoid leaving streams open
    const upgradeHeader = req.headers.get("upgrade");
    if (upgradeHeader?.toLowerCase() === "websocket") {
      return new Response(
        JSON.stringify({ message: "WebSocket proxying not supported" }),
        {
          status: 501,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const session = devhookSessions.get(id);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      return new Response(
        JSON.stringify({ message: "Devhook not connected" }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        }
      );
    }

    try {
      const response = await session.worker.proxy(req);
      if (response.upgrade) {
        return new Response(
          JSON.stringify({ message: "WebSocket proxying not supported" }),
          {
            status: 501,
            headers: { "content-type": "application/json" },
          }
        );
      }

      return new Response(response.body ?? null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      console.error("Devhook proxy error:", error);
      return new Response(JSON.stringify({ message: "Proxy error" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  };

  const handleListen = async (
    _id: string,
    _req: Request
  ): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: "WebSocket required",
        message: "This endpoint requires a WebSocket connection.",
      }),
      {
        status: 426,
        headers: { "content-type": "application/json" },
      }
    );
  };

  return {
    matchRequestHost,
    createRequestURL,
    handleUpgrade,
    handleRequest,
    handleListen,
  };
};

const parseWildcardAccessUrl = (
  value: string | undefined,
  fallbackProtocol: string
): { baseUrl: URL; baseHost: string } | undefined => {
  if (!value) {
    return undefined;
  }

  const raw = value.trim();
  if (!raw) {
    throw new Error("wildcard access url must not be empty");
  }

  const hasScheme = /^https?:\/\//i.test(raw);
  const url = new URL(hasScheme ? raw : `${fallbackProtocol}//${raw}`);

  if (!url.hostname.startsWith("*.")) {
    throw new Error(`wildcard access url must start with "*." (got ${value})`);
  }
  if (url.pathname && url.pathname !== "/") {
    throw new Error(
      `wildcard access url must not include a path (got ${value})`
    );
  }

  const baseHost = url.hostname.slice(2);
  if (!baseHost) {
    throw new Error(`wildcard access url must include a host (got ${value})`);
  }

  const baseUrl = new URL(url.toString());
  baseUrl.hostname = baseHost;
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  return { baseUrl, baseHost };
};
