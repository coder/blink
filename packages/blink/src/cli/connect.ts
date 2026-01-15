import { Server, type ServerOptions } from "@blink-sdk/compute-protocol/server";
import { Emitter } from "@blink-sdk/events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { getHost, toWsUrl } from "./lib/auth";

// Tempfile logger
const tempLogPath = path.join(os.tmpdir(), `blink-connect-${process.pid}.log`);
const serializeError = (err: unknown): string => {
  if (err instanceof Error) return err.stack ?? err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};
const appendLog = async (message: string): Promise<void> => {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    await fs.promises.appendFile(tempLogPath, line, "utf8");
  } catch {}
};

const DEFAULT_HOST = "https://blink.coder.com";

export default async function connect() {
  const url = process.env.BLINK_URL;
  const token = process.env.BLINK_TOKEN;

  // Stop this from leaking to child processes.
  delete process.env.BLINK_TOKEN;

  // These are so Blink can use commits to GitHub properly.
  process.env.GIT_TERMINAL_PROMPT = "0";
  process.env.GIT_PAGER = "cat";
  process.env.GIT_AUTHOR_NAME = "blink-so[bot]";
  process.env.GIT_AUTHOR_EMAIL =
    "211532188+blink-so[bot]@users.noreply.github.com";
  process.env.GIT_COMMITTER_NAME = "blink-so[bot]";
  process.env.GIT_COMMITTER_EMAIL =
    "211532188+blink-so[bot]@users.noreply.github.com";

  // The `gh` CLI is required to be in the workspace.
  // Eventually, we should move this credential helper to just be in the Blink CLI.
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "credential.https://github.com.helper";
  process.env.GIT_CONFIG_VALUE_0 = "!gh auth git-credential";

  process.addListener("uncaughtException", (err) => {
    appendLog(`uncaughtException: ${serializeError(err)}`);
    reportException(token!, err);
  });
  process.addListener("unhandledRejection", (err) => {
    appendLog(`unhandledRejection: ${serializeError(err)}`);
    reportException(token!, err);
  });

  const host = getHost() ?? DEFAULT_HOST;
  const srv = new WorkspaceConnect({
    url: url ?? `${toWsUrl(host)}/api/connect`,
    token,
    createDeploymentFromTar: async (tar) => {
      const uploadURL = new URL("/api/static-deployment", url ?? host);
      const response = await fetch(uploadURL, {
        method: "POST",
        body: tar,
        headers: {
          "Content-Type": "application/tar",
          Authorization: `Bearer ${token}`,
        },
        // @ts-expect-error
        duplex: "half",
      });
      const data = await response.json();
      return data.deployment_id;
    },
  });
  srv.onConnect(() => {
    console.log("Connected");
    appendLog("Connected");
  });
  srv.onDisconnect(() => {
    console.log("Disconnected");
    appendLog("Disconnected");
  });
}

const reportException = async (token: string, err: unknown) => {
  const host = getHost() ?? DEFAULT_HOST;
  const url = new URL(`${host}/api/connect-error`);
  await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      error: err,
    }),
  });
};

export interface WorkspaceConnectOptions {
  url: string;

  token?: string;
  reconnectionDelay?: number;
  // If true, the first reconnect attempt is immediate (no delay).
  immediateReconnectFirst?: boolean;

  // createDeploymentFromTar is a function that creates a Blink deployment from a tar stream.
  createDeploymentFromTar?: ServerOptions["createDeploymentFromTar"];
}

export class WorkspaceConnect {
  private _onConnect = new Emitter();
  public readonly onConnect = this._onConnect.event;
  private _onDisconnect = new Emitter();
  public readonly onDisconnect = this._onDisconnect.event;

  private reconnectTimeout: NodeJS.Timeout | null = null;
  private disposed = false;
  private ws!: WebSocket;
  private server: Server;
  private hasReconnectedOnce = false;

  public constructor(private readonly opts: WorkspaceConnectOptions) {
    let nodePty: typeof import("@lydell/node-pty") | undefined;
    try {
      nodePty = require("@lydell/node-pty");
    } catch (e) {
      // It's fine, we don't _need_ to use TTYs.
    }
    if (typeof Bun !== "undefined") {
      nodePty = undefined;
    }

    this.server = new Server({
      send: (message) => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(message);
        } else {
          console.warn("Message skipped because connection is closed.");
        }
      },
      createDeploymentFromTar: this.opts.createDeploymentFromTar,
      nodePty,
    });

    this.connect();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.ws.close();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
  }

  private scheduleReconnect() {
    if (this.disposed) return;

    const immediateFirst = this.opts.immediateReconnectFirst ?? true;
    const baseDelay = this.opts.reconnectionDelay ?? 2500;

    let delay = baseDelay;
    if (!this.hasReconnectedOnce && immediateFirst) {
      delay = 0;
    }
    this.hasReconnectedOnce = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private connect() {
    const url = new URL(this.opts.url);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    const headers: Record<string, string> = {};
    if (this.opts.token) {
      headers.Authorization = `Bearer ${this.opts.token}`;
    }
    this.ws = new WebSocket(url.toString(), {
      headers,
    });
    this.ws.addEventListener("open", () => {
      this._onConnect.emit(undefined);
    });
    this.ws.addEventListener("close", () => {
      this._onDisconnect.emit(undefined);
      if (this.disposed) {
        return;
      }
      this.scheduleReconnect();
    });
    this.ws.addEventListener("error", (event) => {
      console.error("Error", (event as any).message ?? event);
    });
    this.ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        console.warn("Message skipped because it is not a buffer.");
        return;
      }
      try {
        this.server.handleMessage(new Uint8Array(event.data as ArrayBuffer));
      } catch (err) {
        console.error("message handler error", err);
        try {
          this.ws.close(1011);
        } catch {}
      }
    });
  }
}
