import type { AnyNotificationMessage } from "@blink-sdk/compute-protocol/schema";
import { Worker } from "@blink.so/compute-protocol-worker";
import { DurableObject } from "cloudflare:workers";
import connectToDatabase from "./database";
import {
  createWorkspaceErrorPage,
  type WorkspaceErrorPageAction,
} from "./workspace-error-page";

type WebsocketState =
  | {
      type: "server";
    }
  | {
      type: "client";
      streamID: number;
    }
  | {
      type: "proxied";
      streamID: number;
    };

export type WorkspaceProviderConfig =
  | {
      type: "local-docker";
      container_url: string;
    }
  | {
      type: "daytona";
      snapshot: string;
    };

export type WorkspaceConfig = {
  id: string;
  provider: WorkspaceProviderConfig;

  cleanup?:
    | {
        idleForSeconds: number;
        action: "delete";
        retryIntervalSeconds?: number;
      }
    | {
        idleForSeconds: number;
        action: "stop";
        deleteAfterSeconds: number;
        retryIntervalSeconds?: number;
      };
};

type WorkspaceState =
  | "unconfigured"
  | "starting"
  | "started"
  | "stopped"
  | "stopping"
  | "deleting"
  | "deleted";

interface WebSocket extends globalThis.WebSocket {
  deserializeAttachment(): WebsocketState;
  serializeAttachment(state: WebsocketState): void;
}

export class Workspace extends DurableObject<Cloudflare.Env> {
  private id?: string;
  private config?: WorkspaceConfig;
  private state: WorkspaceState = "unconfigured";
  private instanceID?: string;
  private lastError?: string;
  private errorCount?: number;
  private nextStreamID?: number;
  private cachedWorkerClient?: Worker;
  private chatID?: string;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);

    this.ctx.blockConcurrencyWhile(async () => {
      this.id = await this.ctx.storage.get("id");
      this.config = await this.ctx.storage.get("config");
      this.state = (await this.ctx.storage.get("state")) ?? "unconfigured";
      this.instanceID = await this.ctx.storage.get("instanceID");
      this.lastError = await this.ctx.storage.get("lastError");
      this.errorCount = await this.ctx.storage.get("errorCount");
      this.nextStreamID = await this.ctx.storage.get("nextStreamID");
      this.chatID = await this.ctx.storage.get("chatID");
    });
  }

  // serialize is used for debugging.
  public async serialize() {
    let nextAlarm: number | null = await this.ctx.storage.getAlarm();
    if (nextAlarm !== null) {
      nextAlarm -= Date.now();
    }
    return {
      id: this.id,
      config: this.config,
      state: this.state,
      instanceID: this.instanceID,
      lastError: this.lastError,
      errorCount: this.errorCount,
      nextStreamID: this.nextStreamID,
      chatID: this.chatID,
      nextAlarm: nextAlarm
        ? {
            ms: nextAlarm,
            seconds: nextAlarm / 1000,
            minutes: nextAlarm / 1000 / 60,
          }
        : null,
    };
  }

  // configure sets the config for the workspace.
  // This must be called before other methods.
  public async configure(config: WorkspaceConfig): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.state !== "unconfigured") {
        throw new Error("Workspace already configured");
      }
      await this.setState("stopped");
      this.config = config;
      await this.ctx.storage.put("config", config);
      this.id = config.id;
      await this.ctx.storage.put("id", config.id);
    });
  }

  public getState(): WorkspaceState {
    return this.state;
  }

  public getLastError(): string | undefined {
    return this.lastError;
  }

  private async setLastError(error: string) {
    this.lastError = error;
    await this.ctx.storage.put("lastError", error);
  }

  private async clearLastError() {
    this.lastError = undefined;
    await this.ctx.storage.delete("lastError");
  }

  public getErrorCount(): number {
    return this.errorCount ?? 0;
  }

  private async clearErrorCount() {
    this.errorCount = undefined;
    await this.ctx.storage.delete("errorCount");
  }

  private async incrementErrorCount() {
    const count = (this.errorCount ?? 0) + 1;
    this.errorCount = count;
    await this.ctx.storage.put("errorCount", count);
  }

  public isConnected(): boolean {
    const sockets = this.ctx.getWebSockets("server");
    return sockets.length > 0;
  }

  private async setState(state: WorkspaceState) {
    this.state = state;
    await this.ctx.storage.put("state", state);

    if (!this.chatID) {
      return;
    }

    let userMessage: string;
    let modelMessage: string;
    switch (state) {
      case "stopped":
        userMessage =
          "Your workspace has paused due to inactivity. Don't worry, you have up to 24 hours to restart it while maintaining your previous work.";
        modelMessage =
          "If you require the workspace, you must start it again with `workspace_initialize`. All files have been persisted, but all processes have stopped.";
        break;
      case "deleted":
        userMessage = "Your chat's workspace has been reset due to inactivity!";
        modelMessage =
          "When you initialize a new workspace, all previous filesystem state has been deleted.";
        break;
      default:
        return;
    }

    try {
      const querier = await connectToDatabase(this.env);
      await querier.insertMessages({
        messages: [
          {
            id: crypto.randomUUID(),
            chat_id: this.chatID,
            role: "assistant",
            parts: [
              {
                type: "tool-workspace_state",
                toolCallId: crypto.randomUUID(),
                state: "output-available",
                input: {
                  model_intent: userMessage,
                },
                output: {
                  additional_data: modelMessage,
                },
              },
            ],
          },
        ],
      });
    } catch (err) {
      // This isn't very important, not worth crashing the workspace over.
    }
  }

  private async setInstanceID(instanceID: string) {
    this.instanceID = instanceID;
    await this.ctx.storage.put("instanceID", instanceID);
  }

  // setChatID sets the chatID for the workspace.
  // This is used to inject messages into the chat when the workspace changes state.
  public async setChatID(chatID: string) {
    this.chatID = chatID;
    await this.ctx.storage.put("chatID", chatID);
  }

  // resetCleanupTimer resets the cleanup timer.
  public async resetCleanupTimer() {
    if (!this.config) {
      // If the workspace isn't configured, there is no cleanup to do.
      // It's possible this is called from a workspace which is not
      // provisioned, but instead just dynamically connected.
      return;
    }
    if (!this.config.cleanup) {
      return;
    }
    await this.ctx.storage.setAlarm(
      Date.now() + this.config.cleanup.idleForSeconds * 1000
    );
  }

  // ----- WORKSPACE CONNECTION STATE -----
  // All workspace-connection related state is below.

  public async fetch(request: Request): Promise<Response> {
    const magicIdentifier = request.headers.get("x-blink-magic-connection");
    if (magicIdentifier) {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("Magic requests must be websocket", {
          status: 400,
        });
      }

      const isServer = magicIdentifier === "server";
      const existingServers = this.ctx.getWebSockets("server");
      if (isServer) {
        existingServers.forEach((ws) => {
          ws.close(1000, "A new server instance has connected.");
        });
      } else {
        if (existingServers.length === 0) {
          return new Response("The server is not connected.", {
            status: 503,
          });
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      if (isServer) {
        server.serializeAttachment({
          type: "server",
        });
        this.ctx.acceptWebSocket(server, ["server"]);
      } else {
        const workerClient = this.getWorkerClient();
        const streamID = workerClient.createClientStream();
        server.serializeAttachment({
          type: "client",
          streamID,
        });
        this.ctx.acceptWebSocket(server, ["client", streamID.toString()]);
      }

      return new Response(undefined, {
        status: 101,
        webSocket: client,
      });
    }

    if (this.state !== "started" && this.state !== "unconfigured") {
      let title: string;
      let description: string;
      const actions: WorkspaceErrorPageAction[] = [];
      switch (this.state) {
        case "starting":
          title = "Workspace is starting...";
          description = "It will be alive soon.";
          actions.push({
            label: "Refresh",
            href: "/",
          });
          break;
        case "stopped":
          title = "Workspace is stopped!";
          description =
            "The workspace has stopped. Head to the chat to start it again!";
          actions.push({
            label: "View Your Chats",
            href: "https://blink.coder.com/chat",
          });
          break;
        case "stopping":
          title = "Workspace is stopping...";
          description =
            "The workspace is shutting down due to inactivity. You can start it again soon!";
          actions.push({
            label: "Refresh",
            href: "/",
          });
          break;
        case "deleting":
          title = "Workspace is deleting...";
          description =
            "The workspace is being deleted. Ask for a new one in your chat!";
          actions.push({
            label: "View Your Chats",
            href: "https://blink.coder.com/chat",
          });
          break;
        case "deleted":
          title = "Workspace is deleted!";
          description =
            "The workspace has been deleted. Ask for a new one in your chat!";
          actions.push({
            label: "View Your Chats",
            href: "https://blink.coder.com/chat",
          });
          break;
        default:
          title = "Workspace is in an unknown state!";
          description =
            "An issue exists with your workspace. Please try again later.";
          break;
      }

      return new Response(
        createWorkspaceErrorPage({
          title,
          description,
          actions,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    if (!this.isConnected()) {
      let title: string;
      let description: string;
      let issueText: string | undefined;
      if (this.state === "unconfigured") {
        title = "The workspace isn't connected!";
        description = "You disconnected from `blink chat`!";
      } else {
        title = "The workspace isn't connected!";
        description = "You disconnected from `blink chat`!";
        issueText =
          "If the issue persists, share this error with the Blink team.";
      }

      return new Response(
        createWorkspaceErrorPage({
          title,
          description,
          issueText,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    const proxyURL = request.headers.get("x-blink-proxy-url");
    if (!proxyURL) {
      return new Response("No proxy URL provided", {
        status: 400,
      });
    }
    if (typeof proxyURL !== "string") {
      return new Response("Proxy URL must be a string", {
        status: 400,
      });
    }
    const headers = new Headers(request.headers);
    headers.delete("x-blink-proxy-url");

    const workerClient = this.getWorkerClient();
    try {
      const response = await workerClient.proxy(
        new Request(proxyURL, {
          headers,
          method: request.method,
          body: request.body,
          signal: request.signal,
          // This is very important for user-redirects to work.
          redirect: "manual",
        })
      );
      if (response.upgrade) {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        server.serializeAttachment({
          type: "proxied",
          streamID: response.stream,
        });
        this.ctx.acceptWebSocket(server, [
          "proxied",
          response.stream.toString(),
        ]);
        await this.resetCleanupTimer();
        return new Response(undefined, {
          status: 101,
          webSocket: client,
        });
      }

      // This error comes from fetch if we return a body on these status codes.
      // TypeError: Response with null body status (101, 204, 205, or 304) cannot have a body.
      if ([101, 204, 205, 302, 304].includes(response.status)) {
        response.body = undefined;
      }

      // If we're actively proxying requests, keep the workspace alive.
      await this.resetCleanupTimer();

      return new Response(response.body ?? null, {
        status: response.status,
        headers: response.headers,
        statusText: response.statusText,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "fetch failed") {
        // There isn't anything running on the port.
        const port = new URL(proxyURL).port;
        return new Response(
          createWorkspaceErrorPage({
            title: `Nothing is running on port ${port}`,
            description: "Tell Blink to run something on this port!",
            actions: [
              {
                label: "View Your Chats",
                href: "https://blink.coder.com/chat",
              },
            ],
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "text/html",
            },
          }
        );
      }
      return new Response("Error: " + err, {
        status: 500,
      });
    }
  }

  public async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const workerClient = this.getWorkerClient();
    const state = ws.deserializeAttachment();
    switch (state.type) {
      case "server": {
        if (typeof message === "string") {
          throw new Error("Server should not be sending strings");
        }
        workerClient.handleServerMessage(new Uint8Array(message));
        break;
      }
      case "client": {
        if (typeof message !== "string") {
          throw new Error("Client should be sending strings");
        }
        await this.resetCleanupTimer();
        workerClient.handleClientMessage(state.streamID, message);
        break;
      }
      case "proxied": {
        await this.resetCleanupTimer();
        workerClient.sendProxiedWebSocketMessage(state.streamID, message);
        break;
      }
    }
  }

  public async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const state = ws.deserializeAttachment();
    switch (state.type) {
      case "server": {
        // Close all the clients.
        this.ctx.getWebSockets("client").forEach((ws) => {
          try {
            ws.close(code, "Server disconnected");
          } catch (err) {}
        });
        break;
      }
      case "proxied": {
        const workerClient = this.getWorkerClient();
        workerClient.sendProxiedWebSocketClose(state.streamID, code);
        break;
      }
    }
  }

  public async webSocketError(ws: WebSocket, error: ErrorEvent): Promise<void> {
    // noop this just prevents annoying logs
  }

  private getWorkerClient(): Worker {
    if (!this.cachedWorkerClient) {
      this.cachedWorkerClient = new Worker({
        initialNextStreamID: this.nextStreamID,
        sendToServer: this.boundSendToServer,
        sendToClient: this.boundSendToClient,
      });
      this.cachedWorkerClient.onNextStreamIDChange(
        this.boundOnNextStreamIDChange
      );
      this.cachedWorkerClient.onNotification(this.boundOnNotification);
      this.cachedWorkerClient.onWebSocketMessage(this.boundOnWebSocketMessage);
    }
    return this.cachedWorkerClient;
  }

  private readonly boundSendToServer = (data: Uint8Array) => {
    const servers = this.ctx.getWebSockets("server");
    if (servers.length === 0) {
      throw new Error("No server connected");
    }
    servers.forEach((server) => {
      try {
        server.send(data);
      } catch (err) {
        // noop - it's possible for two servers to be connected at once
        // if it disconnected, then a new one is connecting.
      }
    });
  };

  private readonly boundSendToClient = (streamID: number, message: string) => {
    const [socket] = this.ctx.getWebSockets(streamID.toString());
    if (!socket) {
      console.warn(`No socket found for response to client ${streamID}`);
      return;
    }
    // If clients are still getting messages, we need to keep the workspace alive.
    this.ctx.waitUntil(this.resetCleanupTimer());
    socket.send(message);
  };

  private readonly boundOnNextStreamIDChange = (streamID: number) => {
    this.nextStreamID = streamID;
    this.ctx.waitUntil(this.ctx.storage.put("nextStreamID", streamID));
  };

  private readonly boundOnNotification = (message: AnyNotificationMessage) => {
    const stringified = JSON.stringify(message);
    this.ctx.getWebSockets("client").forEach((ws) => {
      ws.send(stringified);
    });
  };

  private readonly boundOnWebSocketMessage = (event: {
    stream: number;
    message: string | Uint8Array;
  }) => {
    const [socket] = this.ctx.getWebSockets(event.stream.toString());
    if (!socket) {
      return;
    }
    socket.send(event.message);
  };
}
