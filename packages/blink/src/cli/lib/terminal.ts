import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { Terminal } from "@xterm/headless";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

export interface RenderOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface TerminalInstance extends Disposable {
  getScreen(): string;
  getLine(index: number): string;
  getLines(): string[];
  waitUntil(
    condition: (screen: string) => boolean,
    timeoutMs?: number
  ): Promise<void>;
  write(data: string): void;

  /** Underlying Node child process */
  readonly child: ChildProcessWithoutNullStreams;

  /** Underlying xterm Terminal instance */
  readonly terminal: Terminal;
}

class TerminalInstanceImpl implements TerminalInstance {
  public readonly child: ChildProcessWithoutNullStreams;
  public readonly terminal: Terminal;
  private disposed = false;
  private processExited = false;
  private defaultTimeoutMs;

  constructor(command: string, options: RenderOptions = {}) {
    const {
      cols = 80,
      rows = 24,
      cwd = process.cwd(),
      env = process.env as Record<string, string>,
      timeout = 10000,
    } = options;

    this.defaultTimeoutMs = timeout;

    // xterm.js headless terminal buffer (no DOM)
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
    });

    if (process.platform === "win32") {
      throw new Error("Windows is not supported");
    }

    // Run the command under a PTY via `script(1)`:
    //   script -qf -c "<cmd args...>" /dev/null
    // -q (quiet), -f (flush), -c (run command) — output goes to stdout.
    // This is a workaround for Bun not supporting node-pty.
    const argv = [
      "-qf",
      "-c",
      `stty cols ${cols} rows ${rows}; exec ${command}`,
      "/dev/null",
    ];
    const child = spawn("script", argv, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"], // Node creates pipes for us
    }) as ChildProcessWithoutNullStreams;

    this.child = child;

    // Stream stdout → xterm
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.terminal.write(chunk);
    });

    // Mirror stderr to the terminal too
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.terminal.write(chunk);
    });

    child.on("exit", (code, signal) => {
      this.processExited = true;
      if (!this.disposed && code !== 0) {
        console.warn(`Process exited with code ${code}, signal ${signal}`);
      }
    });

    child.on("error", (err) => {
      console.error("Failed to spawn child process:", err);
    });
  }

  private findScript(): string | null {
    const r = spawnSync("which", ["script"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) {
      return r.stdout.trim();
    }
    return null;
  }

  getScreen(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join("\n");
  }

  getLine(index: number): string {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(index);
    return line ? line.translateToString(true) : "";
  }

  getLines(): string[] {
    const buffer = this.terminal.buffer.active;
    const out: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) out.push(line.translateToString(true));
    }
    return out;
  }

  async waitUntil(
    condition: (screen: string) => boolean,
    timeoutMs?: number
  ): Promise<void> {
    const pollInterval = 50;

    return new Promise((resolve, reject) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutId) clearTimeout(timeoutId);
      };

      const check = () => {
        if (condition(this.getScreen())) {
          cleanup();
          resolve();
          return true;
        }
        return false;
      };

      if (check()) return;

      timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timeout after ${timeoutMs}ms\n\nCurrent screen:\n${this.getScreen()}`
          )
        );
      }, timeoutMs ?? this.defaultTimeoutMs);

      pollTimer = setInterval(check, pollInterval);
    });
  }

  write(data: string): void {
    // Send keystrokes to the child’s stdin
    this.child.stdin.write(data);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    try {
      // Politely end stdin; then kill if needed
      this.child.stdin.end();
    } catch {
      /* ignore */
    }

    try {
      this.child.kill();
    } catch (e) {
      console.warn("Error killing child:", e);
    }

    try {
      this.terminal.dispose();
    } catch (e) {
      console.warn("Error disposing terminal:", e);
    }
  }
}

const pathToCliEntrypoint = join(import.meta.dirname, "..", "index.ts");
export const BLINK_COMMAND = `bun ${pathToCliEntrypoint}`;

export function render(
  command: string,
  options?: RenderOptions
): TerminalInstance {
  return new TerminalInstanceImpl(command, options);
}

export async function makeTmpDir(): Promise<
  AsyncDisposable & { path: string }
> {
  const dirPath = await mkdtemp(join(tmpdir(), "blink-tmp-"));
  return {
    path: dirPath,
    [Symbol.asyncDispose](): Promise<void> {
      return rm(dirPath, { recursive: true });
    },
  };
}

export const KEY_CODES = {
  ENTER: "\r",
  TAB: "\t",
  BACKSPACE: "\x08",
  DELETE: "\x7f",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
} as const;
