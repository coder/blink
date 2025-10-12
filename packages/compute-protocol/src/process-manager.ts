import { Emitter } from "@blink-sdk/events";
import type * as pty from "@lydell/node-pty";
import { SerializeAddon } from "@xterm/addon-serialize";
import xterm from "@xterm/headless";
import { type ProcessStatus } from "./schema";
import { spawn as nodeSpawn } from "child_process";

export interface Disposable {
  dispose(): void;
}

export interface Process {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  pid: number;
  pty: Pty;
  terminal: xterm.Terminal;
  serializer: SerializeAddon;

  exitCode: number | undefined;
  exitSignal: number | undefined;
  startTimeMS: number;
  onOutput: (cb: (data: string) => void) => Disposable;
  onExit: (cb: (exitCode: number, signal?: number) => void) => Disposable;
  sendInput: (data: string) => void;
  kill: (signal?: string) => void;
}

export interface ProcessManagerOptions {
  nodePty?: typeof import("@lydell/node-pty");
  env?: Record<string, string>;
}

export class ProcessManager {
  public static readonly COLUMNS = 80;
  public static readonly ROWS = 24;
  // Store a lot of output so that the model can observe the full context.
  public static readonly SCROLLBACK = 128000;

  private globalEnv: Record<string, string>;
  private processes: Map<number, Process> = new Map();
  private spawnListeners: ((process: Process) => void)[] = [];
  private nodePty: typeof import("@lydell/node-pty") | undefined;

  public constructor(options?: ProcessManagerOptions) {
    this.globalEnv = options?.env ?? {};
    this.nodePty = options?.nodePty;
  }

  public onSpawn(cb: (process: Process) => void): Disposable {
    this.spawnListeners.push(cb);
    return {
      dispose: () => {
        this.spawnListeners = this.spawnListeners.filter(
          (listener) => listener !== cb
        );
      },
    };
  }

  public setEnv(env: Record<string, string>) {
    this.globalEnv = {
      ...this.globalEnv,
      ...env,
    };
    // If the value is an empty string, delete the key.
    Object.keys(env).forEach((key) => {
      if (env[key] === "") {
        delete this.globalEnv[key];
      }
    });
  }

  public async execute(
    file: string,
    args: string[],
    options?: {
      env?: Record<string, string>;
      cwd?: string;
    }
  ): Promise<Process> {
    const spawned = await spawn(
      file,
      args,
      {
        // Allow for color output!
        name: "xterm-256color",
        cols: ProcessManager.COLUMNS,
        rows: ProcessManager.ROWS,
        cwd: options?.cwd,
        env: {
          ...globalThis.process.env,
          ...this.globalEnv,
          ...options?.env,
        },
      },
      this.nodePty
    );

    const terminal = new xterm.Terminal({
      allowProposedApi: true,
      convertEol: true,
      scrollback: ProcessManager.SCROLLBACK,
      cols: ProcessManager.COLUMNS,
      rows: ProcessManager.ROWS,
    });
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);

    let latestWritePromise: Promise<void> | undefined;
    spawned.onData((data) => {
      latestWritePromise = new Promise((resolve) => {
        terminal.write(data, resolve);
      });
    });
    terminal.onData((data) => {
      spawned.write(data);
    });

    // Create the process object that we'll return
    const processObj: Process = {
      command: file,
      args,
      cwd: options?.cwd ?? "",
      env: {
        ...options?.env,
      },
      startTimeMS: Date.now(),
      exitCode: undefined,
      exitSignal: undefined,
      pid: spawned.pid,
      pty: spawned,
      terminal,
      serializer: serializeAddon,
      kill: (signal?: string) => {
        spawned.kill(signal);
      },
      onExit: (cb: (exitCode: number, signal?: number) => void) => {
        return spawned.onExit(({ exitCode, signal }) => {
          if (latestWritePromise) {
            latestWritePromise.then(() => {
              cb(exitCode, signal);
            });
          } else {
            cb(exitCode, signal);
          }
        });
      },
      onOutput: (cb: (data: string) => void) => {
        return spawned.onData((data) => {
          cb(data);
        });
      },
      sendInput: (data: string) => {
        terminal.input(data);
      },
    };
    this.processes.set(spawned.pid, processObj);
    spawned.onExit(({ exitCode, signal }) => {
      processObj.exitCode = exitCode;
      processObj.exitSignal = signal;
    });
    for (const listener of this.spawnListeners) {
      listener(processObj);
    }
    return processObj;
  }

  public status(pid: number): ProcessStatus {
    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process with PID ${pid} not found`);
    }
    const plainOutput = this.readPlainOutput(pid);
    return {
      pid: process.pid,
      command: process.command,
      title: process.pty.process,
      args: process.args,
      cwd: process.cwd,
      env: process.env,
      exit_code: process.exitCode,
      exit_signal: process.exitSignal,
      duration_ms: Date.now() - process.startTimeMS,
      output_total_lines: plainOutput.totalLines,
    };
  }

  public list(includeDead: boolean): ProcessStatus[] {
    return Array.from(this.processes.values())
      .filter((process) => includeDead || process.exitCode === undefined)
      .map((process) => this.status(process.pid));
  }

  public getProcess(pid: number): Process | undefined {
    return this.processes.get(pid);
  }

  public readANSIOutput(pid: number, scrollback?: number): string {
    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process with PID ${pid} not found`);
    }
    return process.serializer.serialize({
      scrollback,
    });
  }

  public readPlainOutput(
    pid: number,
    startLine?: number,
    endLine?: number
  ): {
    lines: string[];
    totalLines: number;
  } {
    // Convert from one-based API to zero-based internal indexing
    // Default to line 1 (first line) if not specified
    const startLineZeroBased = startLine ? Math.max(0, startLine - 1) : 0;
    // Default to all lines if not specified
    const endLineZeroBased = endLine
      ? Math.max(0, endLine - 1)
      : ProcessManager.SCROLLBACK + ProcessManager.ROWS - 1;

    const process = this.processes.get(pid);
    if (!process) {
      throw new Error(`Process with PID ${pid} not found`);
    }

    const allLines: string[] = [];
    for (let i = 0; i < ProcessManager.SCROLLBACK + ProcessManager.ROWS; i++) {
      const line = process.terminal.buffer.normal.getLine(i);
      if (line) {
        allLines.push(line.translateToString(true) ?? "");
      }
    }

    // Trim all extra empty lines that exist because of the terminal height.
    while (
      allLines.length > 0 &&
      allLines[allLines.length - 1]!.trim() === ""
    ) {
      allLines.pop();
    }

    return {
      lines: allLines.slice(startLineZeroBased, endLineZeroBased + 1),
      totalLines: allLines.length,
    };
  }

  public close(): void {
    this.processes.forEach((process) => {
      process.pty.kill();
    });
  }
}

interface Pty {
  // process is the title of the process.
  readonly process: pty.IPty["process"];
  readonly pid: pty.IPty["pid"];
  readonly onExit: pty.IPty["onExit"];
  readonly onData: pty.IPty["onData"];
  readonly kill: pty.IPty["kill"];
  readonly write: pty.IPty["write"];
}

const spawn = async (
  file: string,
  args: string[],
  options: pty.IPtyForkOptions,
  nodePty?: typeof import("@lydell/node-pty")
): Promise<Pty> => {
  // Bun does not support the native bindings needed for pty.
  // Because of this, we shim a PTY instead.
  //
  // Bun is a great (not to mention fast) runtime - we want to support it.
  if (!nodePty || typeof globalThis.Bun !== "undefined") {
    // Bun does not support the native bindings needed for pty.
    // So we shim a PTY instead.
    const exitEmitter = new Emitter<{ exitCode: number; signal?: number }>();
    const dataEmitter = new Emitter<string>();

    // These were causing very odd type errors.
    // When we publish this as a package instead of a submodule, we can remove this.
    const proc = nodeSpawn(file, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: "pipe",
    } as any);
    proc.stdout.on("data", (data: any) => {
      dataEmitter.emit(Buffer.from(data).toString("utf-8"));
    });
    proc.stderr.on("data", (data: any) => {
      dataEmitter.emit(Buffer.from(data).toString("utf-8"));
    });
    proc.on("exit", (code: any, signal: any) => {
      let exitCode = code ?? -1;
      let signalCode = signal ? exitCode : undefined;

      exitEmitter.emit({ exitCode, signal: signalCode });
    });

    const pid = new Promise<number>((resolve, reject) => {
      proc.on("spawn", () => {
        resolve(proc.pid ?? -1);
      });
      proc.on("error", (error) => {
        reject(error);
      });
    });

    return {
      pid: await pid,
      process: "",
      onExit: (fn) => {
        return exitEmitter.event(fn);
      },
      kill(signal) {
        proc.kill(signal as NodeJS.Signals);
      },
      onData: (fn) => {
        return dataEmitter.event(fn);
      },
      write(data) {
        proc.stdin?.write(data);
      },
    };
  }
  return nodePty.spawn(file, args, options);
};
