import Multiplexer, { Stream, FrameCodec } from "@blink-sdk/multiplexer";
import { fileTypeFromBuffer } from "file-type";
import * as fs from "fs/promises";
import {
  ProcessManager,
  type Disposable,
  type Process,
} from "./process-manager";
import {
  ClientMessageSchema,
  ClientMessageType,
  RequestSchema,
  ServerMessageType,
  createWebSocketMessagePayload,
  parseWebSocketMessagePayload,
  type AnyRequestMessage,
  type ClientMessage,
  type NotificationMessage,
  type NotificationSchema,
  type RequestMessage,
  type ResponseMessage,
  type ResponseSchema,
  type ServerMessage,
} from "./schema";
import { WebSocket } from "ws";
import { createTarFromDirectory } from "./tar";
import { parse } from "dotenv";

// Helper to trim ANSI output to a safe tail (keep last ~64KB of text)
const truncateAnsi = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
};

// Helper to slice line arrays by total character budget (keep tail)
const truncateLinesByChars = (
  lines: string[],
  limit: number
): { lines: string[]; truncated: boolean } => {
  if (lines.length === 0) return { lines: [], truncated: false };
  let total = 0;
  let startIdx = lines.length; // exclusive start index
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i]!.length;
    if (total + len > limit && startIdx !== lines.length) {
      break;
    }
    total += len;
    startIdx = i;
  }
  if (startIdx === 0) return { lines, truncated: false };
  return { lines: lines.slice(startIdx), truncated: true };
};

export interface ServerOptions {
  send: (message: Uint8Array) => void;
  env?: Record<string, string>;
  createDeploymentFromTar?: (
    tar: ReadableStream<Uint8Array>
  ) => Promise<string>;

  proxyOnly?: boolean;
  // fetchProxyRequest is a function that can be used
  // to route proxy requests wherever the user wants.
  fetchProxyRequest?: (url: string, init: RequestInit) => Promise<Response>;

  // nodePty is an optional dependency that can be used to spawn processes with TTYs.
  // If not provided, the server will spawn processes without TTYs.
  //
  // It's intentionally not bundled for portability.
  // node-pty is very much so not portable.
  nodePty?: typeof import("@lydell/node-pty");
}

export class Server {
  private readonly multiplexer: Multiplexer;
  private readonly notificationStream: Stream;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly processManager: ProcessManager;
  private readonly createDeploymentFromTar?: ServerOptions["createDeploymentFromTar"];
  private readonly proxyOnly?: ServerOptions["proxyOnly"];
  private readonly fetchProxyRequest?: ServerOptions["fetchProxyRequest"];

  public constructor(opts: ServerOptions) {
    this.createDeploymentFromTar = opts.createDeploymentFromTar;
    this.proxyOnly = opts.proxyOnly;
    this.fetchProxyRequest = opts.fetchProxyRequest;
    this.multiplexer = new Multiplexer({
      send: (msg: Uint8Array) => {
        opts.send(msg);
      },
    });
    this.multiplexer.onStream((stream) => {
      this.handleStream(stream);
    });
    this.notificationStream = this.multiplexer.createStream();
    this.processManager = new ProcessManager({
      env: opts.env,
      nodePty: opts.nodePty,
    });
    this.processManager.onSpawn((process) => {
      const update = () => {
        this.sendNotification({
          type: "process_status",
          payload: {
            status: this.processManager.status(process.pid),
          },
        });
      };
      update();
      process.terminal.onTitleChange(() => {
        update();
      });
      process.onExit(() => {
        this.sendNotification({
          type: "process_status",
          payload: {
            status: this.processManager.status(process.pid),
          },
        });
      });
      process.onOutput((output) => {
        // Send process_output in chunks strictly under the multiplexer typed payload limit
        // Max typed payload per frame is FrameCodec.getMaxPayloadSize() - 1 (1 byte for type)
        const maxTypedChunk = FrameCodec.getMaxPayloadSize() - 1;
        for (let i = 0; i < output.length; i += maxTypedChunk) {
          const chunk = output.slice(i, i + maxTypedChunk);
          this.sendNotification({
            type: "process_output",
            payload: {
              pid: process.pid,
              output: chunk,
            },
          });
        }
      });
    });
  }

  public handleMessage(message: Uint8Array): void {
    this.multiplexer.handleMessage(message);
  }

  private handleStream(stream: Stream): void {
    const signal = new AbortController();
    stream.onClose(() => {
      signal.abort();
    });
    stream.onData((message) => {
      const type = message[0];
      const payload = message.subarray(1);
      switch (type) {
        case ClientMessageType.REQUEST: {
          const request = JSON.parse(
            this.decoder.decode(payload)
          ) as AnyRequestMessage;
          if (this.proxyOnly) {
            this.sendResponse(stream, {
              id: request.id,
              error: "This server is in proxy only mode.",
            });
            return;
          }
          this.handleRequest(stream, request, signal.signal).catch((err) => {
            this.sendResponse(stream, {
              id: request.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          break;
        }
        // All other message types are handled by the `handleProxyRequest` method.
        case ClientMessageType.PROXY_INIT: {
          const parsed = ClientMessageSchema[
            ClientMessageType.PROXY_INIT
          ].safeParse(JSON.parse(this.decoder.decode(payload)));
          if (!parsed.success) {
            throw new Error("Invalid proxy init message");
          }

          let promise: Promise<void>;
          if (parsed.data.headers["upgrade"] === "websocket") {
            promise = this.handleProxyWebSocket(stream, parsed.data);
          } else {
            promise = this.handleProxyRequest(stream, parsed.data);
          }
          promise.catch((err) => {
            stream.error(err.message);
          });
          break;
        }
      }
    });
  }

  private async handleProxyWebSocket(
    stream: Stream,
    request: ClientMessage<ClientMessageType.PROXY_INIT>
  ): Promise<void> {
    const url = new URL(request.url);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    const ws = new WebSocket(
      url.toString(),
      request.headers["sec-websocket-protocol"]
        ? request.headers["sec-websocket-protocol"]
        : undefined,
      {
        headers: request.headers,
        perMessageDeflate: false,
      }
    );
    ws.addEventListener("open", () => {
      const init: ServerMessage<ServerMessageType.PROXY_INIT> = {
        status_code: 101,
        status_message: "Switching Protocols",
        headers: {},
      };
      stream.writeTyped(
        ServerMessageType.PROXY_INIT,
        this.encoder.encode(JSON.stringify(init))
      );
    });
    ws.addEventListener("message", (event) => {
      if (stream.disposed) {
        return;
      }
      stream.writeTyped(
        ServerMessageType.PROXY_WEBSOCKET_MESSAGE,
        createWebSocketMessagePayload(event.data as ArrayBuffer, this.encoder)
      );
    });
    ws.addEventListener("close", (event) => {
      if (stream.disposed) {
        return;
      }
      const payload: ServerMessage<ServerMessageType.PROXY_WEBSOCKET_CLOSE> = {
        code: event.code,
        reason: event.reason,
      };
      stream.writeTyped(
        ServerMessageType.PROXY_WEBSOCKET_CLOSE,
        this.encoder.encode(JSON.stringify(payload))
      );
      stream.close();
    });
    ws.addEventListener("error", (event) => {
      console.log("err", event);
    });
    stream.onClose(() => {
      ws.close();
    });
    stream.onError((err) => {
      ws.close(1011, err);
    });
    stream.onData((message) => {
      const payload = message.subarray(1);
      switch (message[0]) {
        case ClientMessageType.PROXY_WEBSOCKET_MESSAGE: {
          const parsed = parseWebSocketMessagePayload(payload, this.decoder);
          ws.send(parsed);
          break;
        }
        case ClientMessageType.PROXY_WEBSOCKET_CLOSE: {
          const parsed = ClientMessageSchema[
            ClientMessageType.PROXY_WEBSOCKET_CLOSE
          ].safeParse(JSON.parse(this.decoder.decode(payload)));
          if (!parsed.success) {
            throw new Error("Invalid proxy websocket close message");
          }
          try {
            ws.close(parsed.data.code, parsed.data.reason);
          } catch (err) {
            console.error("Error closing websocket", err, parsed.data);
          }
          break;
        }
        default:
          stream.error(`Unexpected message type: ${message[0]}`);
      }
    });
  }

  private async handleProxyRequest(
    stream: Stream,
    request: ClientMessage<ClientMessageType.PROXY_INIT>
  ): Promise<void> {
    let bodyWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let bodyReader: ReadableStream<Uint8Array> | undefined;

    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "OPTIONS"
    ) {
      const transform = new TransformStream();
      bodyWriter = transform.writable.getWriter();
      bodyReader = transform.readable;
    }

    stream.onData((message) => {
      switch (message[0]) {
        case ClientMessageType.PROXY_BODY: {
          if (bodyWriter) {
            const chunk = message.subarray(1);
            if (chunk.length === 0) {
              // Empty chunk signals end of body
              bodyWriter.close();
            } else {
              bodyWriter.write(chunk);
            }
          }
          break;
        }
        default:
          stream.error(`Unexpected message type: ${message[0]}`);
      }
    });

    const requestInit: RequestInit = {
      headers: request.headers,
      method: request.method,
      body: bodyReader,
      redirect: "manual",
    };
    let response: Response;
    if (this.fetchProxyRequest) {
      response = await this.fetchProxyRequest(request.url, requestInit);
    } else {
      response = await fetch(request.url, requestInit);
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const init: ServerMessage<ServerMessageType.PROXY_INIT> = {
      headers,
      status_code: response.status,
      status_message: response.statusText,
    };
    stream.writeTyped(
      ServerMessageType.PROXY_INIT,
      this.encoder.encode(JSON.stringify(init))
    );

    const contentLength = response.headers.get("content-length");
    const responseSize = contentLength ? parseInt(contentLength) : 0;

    const maxChunkSize = FrameCodec.getMaxPayloadSize() - 1; // account for 1-byte type prefix in payload

    // Chunk large responses to prevent multiplexer frame size issues.
    // Use exact max payload size from FrameCodec to minimize frame overhead.
    if (responseSize >= maxChunkSize) {
      if (!response.body) {
        stream.close();
        return;
      }
      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (value) {
            // Split large chunks into smaller pieces
            let offset = 0;
            while (offset < value.length) {
              const chunkSize = Math.min(maxChunkSize, value.length - offset);
              const chunk = value.subarray(offset, offset + chunkSize);
              stream.writeTyped(ServerMessageType.PROXY_DATA, chunk);
              offset += chunkSize;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else if (response.body) {
      // Small/medium responses use direct streaming
      await response.body.pipeTo(
        new WritableStream({
          write: (chunk) => {
            stream.writeTyped(ServerMessageType.PROXY_DATA, chunk);
          },
        })
      );
    }

    stream.close();
  }

  private async handleRequest(
    stream: Stream,
    request: AnyRequestMessage,
    signal: AbortSignal
  ): Promise<void> {
    const requestSchema = RequestSchema[request.type];

    const parsed = requestSchema.safeParse(request.payload);
    if (!parsed.success) {
      throw new Error(`Invalid request payload: ${parsed.error.message}`);
    }

    switch (request.type) {
      case "process_execute": {
        // If env_file is provided, read it and merge it with the env
        if (request.payload.env_file) {
          const content = await fs.readFile(request.payload.env_file, "utf-8");
          const env = parse(content);
          request.payload.env = {
            ...request.payload.env,
            ...env,
          };
        }

        const process = await this.processManager.execute(
          request.payload.command,
          request.payload.args,
          {
            cwd: request.payload.cwd,
            env: request.payload.env,
          }
        );

        this.sendResponse<"process_execute">(stream, {
          id: request.id,
          payload: {
            pid: process.pid,
          },
        });
        break;
      }
      case "process_wait": {
        this.handleProcessWait(stream, request, signal);
        break;
      }
      case "process_kill": {
        const process = this.mustGetProcess(request.payload.pid);
        process.kill(request.payload.signal);
        this.sendResponse<"process_kill">(stream, {
          id: request.id,
          payload: {},
        });
        break;
      }
      case "process_list": {
        this.sendResponse<"process_list">(stream, {
          id: request.id,
          payload: {
            processes: this.processManager.list(
              request.payload.include_dead ?? false
            ),
          },
        });
        break;
      }
      case "process_read_plain_output": {
        const process = this.mustGetProcess(request.payload.pid);
        const plainOutput = this.processManager.readPlainOutput(
          request.payload.pid,
          request.payload.start_line,
          request.payload.end_line
        );
        // Keep last ~256KB of plain text (character budget across lines)
        const truncated = truncateLinesByChars(plainOutput.lines, 256_000);
        this.sendResponse<"process_read_plain_output">(stream, {
          id: request.id,
          payload: {
            lines: truncated.lines,
            total_lines: plainOutput.totalLines,
            duration_ms: Date.now() - process.startTimeMS,
            exit_code: process.exitCode,
            exit_signal: process.exitSignal,
          },
        });
        break;
      }
      case "process_send_input": {
        const process = this.mustGetProcess(request.payload.pid);
        process.sendInput(request.payload.data);
        this.sendResponse<"process_send_input">(stream, {
          id: request.id,
          payload: {},
        });
        break;
      }
      case "set_env": {
        this.processManager.setEnv(request.payload.env);
        this.sendResponse<"set_env">(stream, {
          id: request.id,
          payload: {},
        });
        break;
      }
      case "deploy_static_files": {
        if (!this.createDeploymentFromTar) {
          throw new Error(
            "This server does not support static file deployments!"
          );
        }
        const tar = await createTarFromDirectory(request.payload.path);
        const deploymentID = await this.createDeploymentFromTar(tar);
        this.sendResponse<"deploy_static_files">(stream, {
          id: request.id,
          payload: {
            deployment_id: deploymentID,
          },
        });
        break;
      }
      case "read_file": {
        const file = await fs.readFile(request.payload.path);
        const fileType = await fileTypeFromBuffer(file);
        const readAsText = !fileType;
        if (!readAsText) {
          this.sendResponse<"read_file">(stream, {
            id: request.id,
            payload: {
              content: file.toString("base64"),
              mime_type: fileType?.mime as "image/png",
              total_lines: 0,
              lines_read: 0,
              start_line: 0,
            },
          });
          break;
        }
        const content = file.toString("utf-8");
        const allLines = content.split("\n");
        const startLine = Math.max(0, (request.payload.line_start ?? 1) - 1); // Convert to zero-based
        const endLine = Math.min(
          allLines.length,
          request.payload.line_end ?? allLines.length
        ); // Convert to zero-based, inclusive
        const readLines = allLines.slice(startLine, endLine);
        this.sendResponse<"read_file">(stream, {
          id: request.id,
          payload: {
            content: readLines.join("\n"),
            mime_type: "text/plain",
            total_lines: allLines.length,
            lines_read: readLines.length,
            start_line: startLine,
          },
        });
        break;
      }
      case "write_file": {
        if (request.payload.base64) {
          await fs.writeFile(
            request.payload.path,
            Buffer.from(request.payload.content, "base64")
          );
        } else {
          await fs.writeFile(request.payload.path, request.payload.content);
        }
        if (typeof request.payload.mode === "number") {
          await fs.chmod(request.payload.path, request.payload.mode);
        }
        this.sendResponse<"write_file">(stream, {
          id: request.id,
          payload: {},
        });
        break;
      }
      case "read_directory": {
        const files = await fs.readdir(request.payload.path, {
          withFileTypes: true,
        });
        this.sendResponse<"read_directory">(stream, {
          id: request.id,
          payload: {
            entries: files.map((file) => ({
              name: file.name,
              type: file.isDirectory()
                ? "directory"
                : file.isSymbolicLink()
                  ? "symlink"
                  : "file",
            })),
          },
        });
        break;
      }
      default: {
        // @ts-ignore
        throw new Error(`Unknown request type: ${request.type}`);
      }
    }
  }

  private sendResponse<T extends keyof typeof ResponseSchema>(
    stream: Stream,
    response: ResponseMessage<T>
  ) {
    stream.writeTyped(
      ServerMessageType.RESPONSE,
      this.encoder.encode(JSON.stringify(response))
    );
  }

  private sendNotification<T extends keyof typeof NotificationSchema>(
    notification: NotificationMessage<T>
  ) {
    this.notificationStream.write(
      new Uint8Array([
        ServerMessageType.NOTIFICATION,
        ...this.encoder.encode(JSON.stringify(notification)),
      ])
    );
  }

  // handleProcessWait is a helper for handling the process_wait request.
  // It's used by process_execute and process_send_input.
  private handleProcessWait(
    stream: Stream,
    request: RequestMessage<"process_wait">,
    signal: AbortSignal
  ) {
    const payload = request.payload;
    const process = this.mustGetProcess(payload.pid);
    let onOutput: Disposable | undefined;
    let onExit: Disposable | undefined;
    let ended = false;
    let outputIdleTimeout: NodeJS.Timeout | undefined;

    let timeout: NodeJS.Timeout | undefined;
    if (typeof payload.timeout_ms === "number") {
      timeout = setTimeout(() => {
        end();
      }, payload.timeout_ms);
    }

    const end = async () => {
      if (ended) {
        return;
      }
      ended = true;
      // This is janky, but it seems like there's a single tick
      // between when output is available _sometimes_. If we don't
      // do this, semi-occasionally the plain output will be incorrect.
      // TODO: ensure all process output is written before this function is called instead of a sleep
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (onOutput) {
        onOutput.dispose();
      }
      if (onExit) {
        onExit.dispose();
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (outputIdleTimeout) {
        clearTimeout(outputIdleTimeout);
      }
      if (signal?.aborted) {
        return;
      }

      const status = this.processManager.status(payload.pid);
      const plainOutput = this.processManager.readPlainOutput(status.pid);

      // Keep last ~64KB of ANSI-rendered output and ~256KB of plain text
      const ansi_output_truncated = truncateAnsi(
        this.processManager.readANSIOutput(status.pid),
        64_000
      );
      const plain_trunc = truncateLinesByChars(plainOutput.lines, 256_000);

      this.sendResponse<"process_wait">(stream, {
        id: request.id,
        payload: {
          ...status,
          ansi_output: ansi_output_truncated,
          plain_output: {
            lines: plain_trunc.lines,
            total_lines: plainOutput.totalLines,
          },
        },
      });
    };
    if (
      typeof process.exitCode === "number" ||
      typeof process.exitSignal === "number"
    ) {
      end();
      return;
    }

    // This is just used to track idle commands.
    onOutput = process.onOutput(() => {
      if (outputIdleTimeout) {
        clearTimeout(outputIdleTimeout);
      }
      if (typeof payload.output_idle_timeout_ms === "number") {
        outputIdleTimeout = setTimeout(() => {
          end();
        }, payload.output_idle_timeout_ms);
      }
    });
    onExit = process.onExit(() => {
      end();
    });

    signal.addEventListener("abort", () => {
      end();
    });
  }

  private mustGetProcess(pid: number): Process {
    const process = this.processManager.getProcess(pid);
    if (!process) {
      throw new Error(`Process ${pid} not found`);
    }
    return process;
  }
}
