import { Server } from "@blink-sdk/compute-protocol/server";
import { FrameCodec, MessageType } from "@blink-sdk/multiplexer";
import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";
import type { WebSocket, ServerOptions as WebSocketServerOptions } from "ws";
import { WebSocketServer } from "ws";

const defaultEnvVariables = {
  // These are so Blink can use commits to GitHub properly.
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  GIT_AUTHOR_NAME: "blink-so[bot]",
  GIT_AUTHOR_EMAIL: "211532188+blink-so[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "blink-so[bot]",
  GIT_COMMITTER_EMAIL: "211532188+blink-so[bot]@users.noreply.github.com",

  // The `gh` CLI is required to be in the workspace.
  // Eventually, we should move this credential helper to just be in the Blink CLI.
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
  GIT_CONFIG_VALUE_0: "!gh auth git-credential",
};

interface ClientConnection {
  ws: WebSocket;
  clientToServerStream: Map<number, number>;
  serverToClientStream: Map<number, number>;
}

const toUint8Array = (
  data: Buffer | ArrayBuffer | Uint8Array | Buffer[]
): Uint8Array => {
  if (Array.isArray(data)) {
    const combined = Buffer.concat(data);
    return new Uint8Array(
      combined.buffer,
      combined.byteOffset,
      combined.byteLength
    );
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
};

type MultiplexerFrame = ReturnType<typeof FrameCodec.decode>;

const encodeForClient = (
  frame: MultiplexerFrame,
  streamId: number
): { buffer: Buffer; release: () => void } => {
  const encoded = FrameCodec.encode({
    streamId,
    type: frame.type,
    flags: frame.flags,
    payload: frame.payload,
  });
  const buffer = Buffer.from(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength
  );
  return {
    buffer,
    release: () => FrameCodec.releaseBuffer(encoded),
  };
};

const encodeForServer = (
  frame: MultiplexerFrame,
  streamId: number
): Uint8Array => {
  const encoded = FrameCodec.encode({
    streamId,
    type: frame.type,
    flags: frame.flags,
    payload: frame.payload,
  });
  return encoded;
};

export interface ServeComputeOptions {
  host?: string;
  port?: number;
  logger?: {
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
  };
  createWebSocketServer?: (options: WebSocketServerOptions) => WebSocketServer;
}

const waitForListening = (wss: WebSocketServer): Promise<void> => {
  return new Promise((resolve) => {
    const address = wss.address();
    if (address) {
      resolve();
      return;
    }
    wss.once("listening", () => resolve());
  });
};

const resolvePort = (wss: WebSocketServer, fallback: number): number => {
  const address = wss.address();
  if (typeof address === "object" && address) {
    return (address as AddressInfo).port;
  }
  if (typeof address === "number") {
    return address;
  }
  return fallback;
};

export default async function serveCompute(
  options: ServeComputeOptions = {}
): Promise<WebSocketServer> {
  const logger = options.logger ?? console;
  for (const [key, value] of Object.entries(defaultEnvVariables)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const port =
    options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 22137);
  if (isNaN(port)) {
    throw new Error("PORT environment variable is not a number");
  }

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";

  let nodePty: typeof import("@lydell/node-pty") | undefined;
  try {
    nodePty = require("@lydell/node-pty");
  } catch (e) {
    // It's fine, we don't _need_ to use TTYs.
  }
  if (typeof Bun !== "undefined") {
    nodePty = undefined;
  }

  const clients = new Set<ClientConnection>();
  // Track which remote websocket owns a given server-side stream.
  const serverStreamOwners = new Map<number, ClientConnection>();
  let nextServerStreamId = 1;

  // Server-initiated streams (notifications, proxy responses, etc.) are copied to every client.
  const broadcastServerFrame = (frameData: Uint8Array) => {
    for (const client of clients) {
      client.ws.send(Buffer.from(frameData));
    }
  };

  const cleanupStreamMapping = (
    client: ClientConnection,
    serverStreamId: number
  ) => {
    const clientStreamId = client.serverToClientStream.get(serverStreamId);
    if (clientStreamId !== undefined) {
      client.serverToClientStream.delete(serverStreamId);
      client.clientToServerStream.delete(clientStreamId);
    }
    serverStreamOwners.delete(serverStreamId);
  };

  const server = new Server({
    nodePty,
    send: (message: Uint8Array) => {
      let frame: MultiplexerFrame;
      using _releaser = {
        [Symbol.dispose]() {
          FrameCodec.releaseBuffer(message);
        },
      };
      try {
        frame = FrameCodec.decode(message);
      } catch (err) {
        logger.error("Failed to decode server frame", err);
        return;
      }
      const owner = serverStreamOwners.get(frame.streamId);
      if (owner) {
        const clientStreamId = owner.serverToClientStream.get(frame.streamId);
        if (clientStreamId === undefined) {
          cleanupStreamMapping(owner, frame.streamId);
          return;
        }
        const { buffer, release } = encodeForClient(frame, clientStreamId);
        try {
          owner.ws.send(buffer);
        } finally {
          release();
        }
        if (
          frame.type === MessageType.CLOSE ||
          frame.type === MessageType.ERROR
        ) {
          cleanupStreamMapping(owner, frame.streamId);
        }
        return;
      }

      if (frame.streamId % 2 === 0) {
        // Broadcast server-initiated streams (e.g., notifications) to all clients.
        broadcastServerFrame(message);
      } else {
        // Stream owner vanished (client disconnected). Drop the frame.
      }
    },
  });

  const allocateServerStreamId = () => {
    const streamId = nextServerStreamId;
    nextServerStreamId += 2;
    return streamId;
  };

  const forwardToServer = (frame: MultiplexerFrame): void => {
    const encoded = encodeForServer(frame, frame.streamId);
    try {
      server.handleMessage(encoded);
    } finally {
      FrameCodec.releaseBuffer(encoded);
    }
  };

  const wss =
    options.createWebSocketServer?.({ port, host }) ??
    new WebSocketServer({ port, host });

  await waitForListening(wss);

  const resolvedPort = resolvePort(wss, port);
  logger.info(`Compute server running on ${host}:${resolvedPort}`);

  wss.on("connection", (ws) => {
    logger.info("Client connected");
    const client: ClientConnection = {
      ws,
      clientToServerStream: new Map(),
      serverToClientStream: new Map(),
    };
    clients.add(client);

    ws.on("message", (raw) => {
      if (typeof raw === "string") {
        logger.warn("Ignoring unexpected text message from client");
        return;
      }
      const data = toUint8Array(raw as Buffer | ArrayBuffer | Uint8Array);
      let frame: MultiplexerFrame;
      try {
        frame = FrameCodec.decode(data);
      } catch (err) {
        logger.error("Failed to decode client frame", err);
        ws.close(1002, "invalid frame");
        return;
      }
      let serverStreamId = client.clientToServerStream.get(frame.streamId);
      if (serverStreamId === undefined) {
        serverStreamId = allocateServerStreamId();
        client.clientToServerStream.set(frame.streamId, serverStreamId);
        client.serverToClientStream.set(serverStreamId, frame.streamId);
        serverStreamOwners.set(serverStreamId, client);
      }
      // Rewrite the stream ID so that all clients share a single server instance.
      frame.streamId = serverStreamId;
      forwardToServer(frame);
      if (
        frame.type === MessageType.CLOSE ||
        frame.type === MessageType.ERROR
      ) {
        cleanupStreamMapping(client, serverStreamId);
      }
    });

    const closeClientStreams = () => {
      for (const serverStreamId of [...client.serverToClientStream.keys()]) {
        const cleanupFrame: MultiplexerFrame = {
          streamId: serverStreamId,
          type: MessageType.CLOSE,
          flags: 0,
          payload: new Uint8Array(0),
        };
        forwardToServer(cleanupFrame);
        cleanupStreamMapping(client, serverStreamId);
      }
    };

    ws.on("close", () => {
      closeClientStreams();
      clients.delete(client);
      logger.info("Client disconnected");
    });

    ws.on("error", () => {
      closeClientStreams();
      clients.delete(client);
    });
  });

  return wss;
}
