import { spawn, type ChildProcess } from "child_process";
import { join } from "path";

interface TSServerRequest {
  seq: number;
  type: "request";
  command: string;
  arguments?: any;
}

interface TSServerResponse {
  seq: number;
  type: "response";
  command: string;
  request_seq: number;
  success: boolean;
  message?: string;
  body?: any;
}

interface TSServerEvent {
  seq: number;
  type: "event";
  event: string;
  body?: any;
}

type TSServerMessage = TSServerResponse | TSServerEvent;

/**
 * A wrapper around TypeScript's tsserver for getting completions, diagnostics, and other language features.
 * Uses the native tsserver protocol over stdin/stdout.
 */
export class TSServer {
  private process: ChildProcess;
  private seq = 0;
  private responseBuffer = "";
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: TSServerResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private eventHandlers = new Map<string, (event: TSServerEvent) => void>();

  constructor(private workingDirectory: string) {
    // Spawn tsserver using the typescript package
    this.process = spawn(
      process.execPath,
      [
        join(
          workingDirectory,
          "node_modules",
          "typescript",
          "lib",
          "tsserver.js"
        ),
      ],
      {
        stdio: "pipe",
        cwd: workingDirectory,
      }
    );

    // Set up stdout handler to parse responses
    this.process.stdout?.on("data", (data) => {
      this.handleStdout(data);
    });

    this.process.stderr?.on("data", (data) => {
      console.error("[tsserver stderr]", data.toString());
    });

    this.process.on("error", (err) => {
      console.error("[tsserver error]", err);
      // Reject all pending requests
      for (const [seq, { reject }] of this.pendingRequests) {
        reject(new Error(`tsserver process error: ${err.message}`));
      }
      this.pendingRequests.clear();
    });

    this.process.on("exit", (code) => {
      console.log(`[tsserver exit] code: ${code}`);
      // Reject all pending requests
      for (const [seq, { reject }] of this.pendingRequests) {
        reject(new Error(`tsserver exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });
  }

  private handleStdout(data: Buffer) {
    this.responseBuffer += data.toString();

    // Parse responses - they have format:
    // Content-Length: <length>\r\n\r\n<json>
    while (true) {
      const headerEnd = this.responseBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.responseBuffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) {
        console.error("[tsserver] Invalid header:", header);
        this.responseBuffer = this.responseBuffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1]!, 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.responseBuffer.length < messageEnd) {
        // Not enough data yet
        break;
      }

      const messageJson = this.responseBuffer.slice(messageStart, messageEnd);
      this.responseBuffer = this.responseBuffer.slice(messageEnd);

      try {
        const message: TSServerMessage = JSON.parse(messageJson);
        this.handleMessage(message);
      } catch (err) {
        console.error("[tsserver] Failed to parse message:", messageJson, err);
      }
    }
  }

  private handleMessage(message: TSServerMessage) {
    if (message.type === "response") {
      const pending = this.pendingRequests.get(message.request_seq);
      if (pending) {
        this.pendingRequests.delete(message.request_seq);
        if (message.success) {
          pending.resolve(message);
        } else {
          pending.reject(
            new Error(message.message || "tsserver request failed")
          );
        }
      }
    } else if (message.type === "event") {
      const handler = this.eventHandlers.get(message.event);
      if (handler) {
        handler(message);
      }
    }
  }

  private sendRequest(command: string, args?: any): Promise<TSServerResponse> {
    const seq = ++this.seq;
    const request: TSServerRequest = {
      seq,
      type: "request",
      command,
      arguments: args,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(seq, { resolve, reject });

      const requestJson = JSON.stringify(request) + "\n";
      this.process.stdin?.write(requestJson);

      // Set a timeout for the request
      setTimeout(() => {
        const pending = this.pendingRequests.get(seq);
        if (pending) {
          this.pendingRequests.delete(seq);
          reject(new Error(`tsserver request timed out: ${command}`));
        }
      }, 10000);
    });
  }

  /**
   * Open a file in tsserver. This must be done before querying information about the file.
   */
  async openFile(file: string, fileContent?: string): Promise<void> {
    const absolutePath = join(this.workingDirectory, file);
    await this.sendRequest("open", {
      file: absolutePath,
      fileContent,
    });
  }

  /**
   * Close a file in tsserver.
   */
  async closeFile(file: string): Promise<void> {
    const absolutePath = join(this.workingDirectory, file);
    await this.sendRequest("close", {
      file: absolutePath,
    });
  }

  /**
   * Get completions at a position in a file.
   * Line and offset are 1-based.
   */
  async getCompletions(
    file: string,
    line: number,
    offset: number,
    prefix?: string
  ): Promise<any> {
    const absolutePath = join(this.workingDirectory, file);
    const response = await this.sendRequest("completionInfo", {
      file: absolutePath,
      line,
      offset,
      prefix,
    });
    return response.body;
  }

  /**
   * Get quick info (hover information) at a position.
   * Line and offset are 1-based.
   */
  async getQuickInfo(file: string, line: number, offset: number): Promise<any> {
    const absolutePath = join(this.workingDirectory, file);
    const response = await this.sendRequest("quickinfo", {
      file: absolutePath,
      line,
      offset,
    });
    return response.body;
  }

  /**
   * Get definition location for a symbol.
   * Line and offset are 1-based.
   */
  async getDefinition(
    file: string,
    line: number,
    offset: number
  ): Promise<any> {
    const absolutePath = join(this.workingDirectory, file);
    const response = await this.sendRequest("definition", {
      file: absolutePath,
      line,
      offset,
    });
    return response.body;
  }

  /**
   * Get semantic diagnostics (type errors) for a file.
   */
  async getSemanticDiagnostics(file: string): Promise<any> {
    const absolutePath = join(this.workingDirectory, file);
    const response = await this.sendRequest("semanticDiagnosticsSync", {
      file: absolutePath,
    });
    return response.body;
  }

  /**
   * Get syntactic diagnostics (syntax errors) for a file.
   */
  async getSyntacticDiagnostics(file: string): Promise<any> {
    const absolutePath = join(this.workingDirectory, file);
    const response = await this.sendRequest("syntacticDiagnosticsSync", {
      file: absolutePath,
    });
    return response.body;
  }

  /**
   * Get references to a symbol.
   * Line and offset are 1-based.
   */
  async getReferences(
    file: string,
    line: number,
    offset: number
  ): Promise<any> {
    const absolutePath = join(this.workingDirectory, file);
    const response = await this.sendRequest("references", {
      file: absolutePath,
      line,
      offset,
    });
    return response.body;
  }

  /**
   * Reload projects (useful after changing tsconfig.json).
   */
  async reloadProjects(): Promise<void> {
    await this.sendRequest("reloadProjects");
  }

  /**
   * Listen for events from tsserver.
   */
  onEvent(eventName: string, handler: (event: TSServerEvent) => void): void {
    this.eventHandlers.set(eventName, handler);
  }

  /**
   * Shut down the tsserver process.
   */
  close(): void {
    this.process.kill();
  }
}
