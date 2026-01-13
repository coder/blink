import { mock } from "bun:test";
import { Readable, Writable } from "node:stream";
import Client from "@blink.so/api";
import { Terminal } from "@xterm/headless";

// Type-safe mock function that preserves the original function's types
// biome-ignore lint/suspicious/noExplicitAny: generic function type
type TypedMockFn<T extends (...args: any[]) => any> = T & {
  mockResolvedValue: (value: Awaited<ReturnType<T>>) => TypedMockFn<T>;
  mockRejectedValue: (value: unknown) => TypedMockFn<T>;
  mockImplementation: (
    impl: (...args: Parameters<T>) => ReturnType<T>
  ) => TypedMockFn<T>;
  mockReturnValue: (value: ReturnType<T>) => TypedMockFn<T>;
  mockClear: () => TypedMockFn<T>;
  mockReset: () => TypedMockFn<T>;
};

// Type that converts all methods in an object to typed mocks
type MockedMethods<T> = {
  // biome-ignore lint/suspicious/noExplicitAny: recursive type needs any
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? TypedMockFn<T[K]>
    : T[K] extends object
      ? MockedMethods<T[K]>
      : T[K];
};

// Mocked Client type where all methods are type-safe mocks
export type MockedClient = MockedMethods<Client>;

/**
 * Recursively replace all methods with mocks that reject by default.
 * Tests must explicitly mock methods they use with .mockResolvedValue().
 */
function mockAllMethods(
  obj: object,
  path = "",
  visited = new WeakSet<object>()
): void {
  if (visited.has(obj)) return;
  visited.add(obj);

  for (const key of Object.keys(obj)) {
    // biome-ignore lint/suspicious/noExplicitAny: easier that way
    const value = (obj as any)[key];
    const newPath = path ? `${path}.${key}` : key;

    if (value && typeof value === "object" && value.constructor !== Object) {
      // Nested class instance - recurse into it and also mock its prototype methods
      mockAllMethods(value, newPath, visited);
      for (const method of Object.getOwnPropertyNames(
        Object.getPrototypeOf(value)
      )) {
        if (method !== "constructor" && typeof value[method] === "function") {
          value[method] = mock(() => {
            throw new Error(`${newPath}.${method} not mocked`);
          });
        }
      }
    }
  }
}

/**
 * Create a mock API client where all methods reject by default.
 * Tests must explicitly mock methods they use with .mockResolvedValue().
 *
 * @example
 * const client = createMockClient();
 * client.organizations.list.mockResolvedValue([{ id: "org-1", name: "My Org" }]);
 */
export function createMockClient(): MockedClient {
  const client = new Client({ baseURL: "http://mock" });
  mockAllMethods(client);
  return client as unknown as MockedClient;
}

/**
 * Mock writable stream that captures output to a buffer.
 * Compatible with clack/prompts output requirements.
 */
export class MockWritable extends Writable {
  public buffer: string[] = [];
  public isTTY = true;
  public columns = 200;
  public rows = 24;

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: () => void
  ): void {
    this.buffer.push(chunk.toString());
    callback();
  }

  /**
   * Get all captured output as a single string.
   */
  getOutput(): string {
    return this.buffer.join("");
  }

  /**
   * Clear the output buffer.
   */
  clear(): void {
    this.buffer = [];
  }
}

/**
 * Mock readable stream that allows programmatic input.
 * Compatible with clack/prompts input requirements.
 */
export class MockReadable extends Readable {
  protected _buffer: unknown[] | null = [];
  public isTTY = true;

  override _read(): void {
    if (this._buffer === null) {
      this.push(null);
      return;
    }
    for (const val of this._buffer) {
      this.push(val);
    }
    this._buffer = [];
  }

  /**
   * Push a value to the input stream.
   */
  pushValue(val: unknown): void {
    this._buffer?.push(val);
  }

  /**
   * Close the input stream.
   */
  close(): void {
    this._buffer = null;
  }
}

/**
 * IO context for in-memory CLI testing.
 * Pass this to CLI commands that support dependency injection.
 */
export interface CLITestIO {
  input: MockReadable;
  output: MockWritable;
}

/**
 * Create a new IO context for testing.
 */
export function createTestIO(): CLITestIO {
  return {
    input: new MockReadable(),
    output: new MockWritable(),
  };
}

/**
 * Dependencies that can be injected into CLI commands for testing.
 */
export interface CLIDeps {
  /**
   * IO streams for prompts. If not provided, uses process.stdin/stdout.
   */
  io?: CLITestIO;

  /**
   * API client instance. If not provided, a new client is created.
   */
  client?: Client;

  /**
   * Authentication function. If not provided, uses the default loginIfNeeded.
   */
  authenticate?: () => Promise<string>;
}

/**
 * Key codes for simulating keyboard input in tests.
 * These match the codes used by clack/prompts.
 */
export const KEY_CODES = {
  ENTER: "\r",
  TAB: "\t",
  BACKSPACE: "\x08",
  DELETE: "\x7f",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  ESCAPE: "\x1b",
  SPACE: " ",
  CTRL_C: "\x03",
} as const;

/**
 * Captures stdout output by mocking process.stdout.write.
 * Uses xterm headless terminal to properly render ANSI escape codes.
 * Returns a disposable that restores the original write function.
 *
 * @example
 * using capture = captureStdout();
 * clack.intro("Hello");
 * expect(await capture.getOutput()).toContain("Hello");
 */
export function captureStdout(options?: {
  cols?: number;
  rows?: number;
}): Disposable & {
  getOutput: () => Promise<string>;
  waitUntil: (
    condition: (output: string) => boolean,
    timeoutMs?: number
  ) => Promise<void>;
} {
  const { cols = 200, rows = 24 } = options ?? {};

  const terminal = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
  });

  const originalWrite = process.stdout.write.bind(process.stdout);
  const pendingWrites: Promise<void>[] = [];

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean => {
    const str =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();

    // Track when write is complete
    const writePromise = new Promise<void>((resolve) => {
      terminal.write(str, resolve);
    });
    pendingWrites.push(writePromise);

    // Don't actually write to stdout during tests
    if (typeof encodingOrCallback === "function") {
      encodingOrCallback();
    } else if (callback) {
      callback();
    }
    return true;
  }) as typeof process.stdout.write;

  const getOutput = async (): Promise<string> => {
    await Promise.all(pendingWrites);
    pendingWrites.length = 0;

    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join("\n");
  };

  const waitUntil = async (
    condition: (output: string) => boolean,
    timeoutMs = 5000
  ): Promise<void> => {
    const pollInterval = 10;

    return new Promise((resolve, reject) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutId) clearTimeout(timeoutId);
      };

      const check = async () => {
        const output = await getOutput();
        if (condition(output)) {
          cleanup();
          resolve();
          return true;
        }
        return false;
      };

      check().then((done) => {
        if (done) return;

        timeoutId = setTimeout(async () => {
          cleanup();
          const output = await getOutput();
          reject(
            new Error(
              `waitUntil timed out after ${timeoutMs}ms\n\nCurrent output:\n${output}`
            )
          );
        }, timeoutMs);

        pollTimer = setInterval(() => check(), pollInterval);
      });
    });
  };

  return {
    getOutput,
    waitUntil,
    [Symbol.dispose]: () => {
      process.stdout.write = originalWrite;
      terminal.dispose();
    },
  };
}

/**
 * Mocks stdin to allow programmatic input to clack prompts.
 * Returns a disposable that restores the original stdin behavior.
 *
 * @example
 * using stdin = mockStdin();
 * const confirmPromise = clack.confirm({ message: "Continue?" });
 * stdin.write("y");
 * stdin.write(KEY_CODES.ENTER);
 * const result = await confirmPromise;
 */
export function mockStdin(): Disposable & {
  write: (data: string) => void;
  writeKey: (key: keyof typeof KEY_CODES) => void;
} {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = process.stdin.setRawMode?.bind(process.stdin);

  // Make stdin look like a TTY
  (process.stdin as { isTTY: boolean }).isTTY = true;

  // Mock setRawMode to not throw
  process.stdin.setRawMode = () => process.stdin;

  return {
    write: (data: string) => {
      process.stdin.push(data);
    },
    writeKey: (key: keyof typeof KEY_CODES) => {
      process.stdin.push(KEY_CODES[key]);
    },
    [Symbol.dispose]: () => {
      (process.stdin as { isTTY: boolean | undefined }).isTTY = originalIsTTY;
      if (originalSetRawMode) {
        process.stdin.setRawMode = originalSetRawMode;
      }
    },
  };
}

/**
 * Combined stdout capture and stdin mock for testing interactive prompts.
 *
 * @example
 * using io = mockIO();
 * const selectPromise = clack.select({ message: "Choose:", options: [...] });
 * io.stdin.write(KEY_CODES.DOWN);
 * io.stdin.write(KEY_CODES.ENTER);
 * const result = await selectPromise;
 * expect(io.stdout.getOutput()).toContain("Choose:");
 */
export function mockIO(): Disposable & {
  stdout: ReturnType<typeof captureStdout>;
  stdin: ReturnType<typeof mockStdin>;
} {
  const stdout = captureStdout();
  const stdin = mockStdin();

  return {
    stdout,
    stdin,
    [Symbol.dispose]: () => {
      stdin[Symbol.dispose]();
      stdout[Symbol.dispose]();
    },
  };
}
