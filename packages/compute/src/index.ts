import { Client } from "@blink-sdk/compute-protocol/client";
import { createInMemoryClientServer } from "@blink-sdk/compute-protocol/transport";
import {
  tool,
  type JSONValue,
  type Tool,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";
import { structuredPatch } from "diff";
import type { ToolWithContext } from "blink";

const limits = {
  readLineLimit: 2000,
  readLineLengthLimit: 2000,
  plainOutputCharacterLimit: 8192,
};

export interface ComputeToolContext {
  /**
   * By default, this will use the local compute instance of the agent.
   * If provided, you can use a remote compute instance.
   */
  client?: Client | Promise<Client> | (() => Promise<Client>);
}

let localComputeClient: Promise<Client>;

const toolWithCompute = (
  fn: (ctx: { client: () => Promise<Client> }) => Tool
): ToolWithContext<ComputeToolContext, Tool> => {
  const getLocalComputeClient = () => {
    if (localComputeClient) {
      return localComputeClient;
    }
    localComputeClient = Promise.resolve(createInMemoryClientServer().client);
    return localComputeClient;
  };
  return {
    ...fn({
      client() {
        return getLocalComputeClient();
      },
    }),
    withContext: (ctx: ComputeToolContext) => {
      if (!ctx.client) {
        ctx.client = getLocalComputeClient();
      }

      // This is all janky and should be fixed up.
      if (typeof ctx.client === "function") {
        const clientFn = ctx.client;
        return fn({
          client: clientFn,
        });
      }

      return fn({
        client: () => Promise.resolve(ctx.client as Client),
      });
    },
  };
};

// Strip ANSI output from the model result.
// The model already has the plain output, so this just wastes tokens.
const stripAnsi = (
  output: any
): {
  type: "json";
  value: JSONValue;
} => {
  const { ansiOutput, ...newResult } = output;
  return {
    type: "json",
    value: newResult,
  };
};

export const tools = {
  execute_bash: toolWithCompute(({ client }) => ({
    description: `Execute a bash command in a compute instance. **ALL OUTPUT IS AUTOMATICALLY CAPTURED AND STORED** - never use pipes to filter output during execution.

**Process Management:**
- Use the returned PID with \`process_wait\` to get complete results
- Use \`process_grep_output\` to search through the FULL stored output
- Use \`process_read_output\` to read any portion of the stored output
- **NEVER use pipes like \`| grep\`, \`| head\`, \`| tail\`** - run commands cleanly and analyze afterward

**Output Storage:**
- Every command's complete stdout/stderr is permanently stored
- You can search, filter, and read from this stored output multiple times
- No information is ever lost, even from long-running processes

Example workflow:
1. \`execute_bash\` returns PID 123
2. \`process_wait\` on PID 123 to see if it completed
3. \`process_grep_output\` on PID 123 to find errors`,
    inputSchema: z.object({
      command: z.string(),
      working_directory: z
        .string()
        .describe(
          "The working directory to execute the command in. Use '.' for the current directory."
        ),
      env: z.record(z.string(), z.string()),
      env_file: z
        .string()
        .optional()
        .describe("A file to read environment variables from. e.g. .env.local"),
    }),
    execute: async (args, opts) => {
      return (await client()).request(
        "process_execute",
        {
          command: "bash",
          args: ["-c", args.command],
          cwd: args.working_directory,
          env: args.env,
          env_file: args.env_file,
        },
        {
          signal: opts.abortSignal,
        }
      );
    },
  })),

  execute_bash_sync: toolWithCompute(({ client }) => ({
    description: `Execute a bash command and return output synchronously in a compute instance. **ALL OUTPUT IS AUTOMATICALLY CAPTURED AND STORED** - never use pipes to filter output during execution.

Use the same rules as \`execute_bash\`, but the output is returned synchronously.`,
    inputSchema: z.object({
      command: z.string(),
      working_directory: z
        .string()
        .describe(
          "The working directory to execute the command in. Use '.' for the current directory."
        ),
      env: z.record(z.string(), z.string()),
      env_file: z
        .string()
        .optional()
        .describe("A file to read environment variables from. e.g. .env.local"),
    }),
    async *execute(args, opts) {
      const result = await (
        await client()
      ).request(
        "process_execute",
        {
          command: "bash",
          args: ["-c", args.command],
          cwd: args.working_directory,
          env: args.env,
          env_file: args.env_file,
        },
        {
          signal: opts.abortSignal,
        }
      );
      for await (const waitResult of doProcessWait({
        client: await client(),
        pid: result.pid,
        abortSignal: opts.abortSignal,
      })) {
        yield waitResult;
      }
    },
    toModelOutput: stripAnsi,
  })),

  process_send_input: toolWithCompute(({ client }) => ({
    description: `Send input to a process by PID that was started by the execute_bash tool.

    Use "\r\n" to send a newline (e.g. for an interactive prompt).`,
    inputSchema: z.object({
      pid: z.number(),
      data: z.string(),
    }),
    execute: async (args, opts) => {
      return (await client()).request(
        "process_send_input",
        {
          pid: args.pid,
          data: args.data,
        },
        {
          signal: opts.abortSignal,
        }
      );
    },
  })),

  process_kill: toolWithCompute(({ client }) => ({
    description: `Kill a process by PID that was started by the execute_bash tool.`,
    inputSchema: z.object({
      pid: z.number(),
      signal: z.string(),
    }),
    execute: async (args, opts) => {
      return (await client()).request(
        "process_kill",
        {
          pid: args.pid,
          signal: args.signal,
        },
        {
          signal: opts.abortSignal,
        }
      );
    },
  })),

  process_wait: toolWithCompute(({ client }) => ({
    description: `This tool waits for a process to exit, or returns instantly if the process already has exited.

Output from the process will be returned along with it's exit code, duration, and whether the process is still running.

IMPORTANT: ALWAYS use this tool to determine the status of a process. NEVER use "ps".
`,
    inputSchema: z.object({
      pid: z.number(),
      timeout_ms: z
        .number()
        .optional()
        .describe(
          "The timeout in milliseconds to wait to return output. This does *not* kill the process, it simply returns early with current output of the process. Defaults to 25 seconds."
        ),
    }),
    async *execute(args, opts) {
      for await (const waitResult of doProcessWait({
        client: await client(),
        pid: args.pid,
        abortSignal: opts.abortSignal,
        timeoutMs: args.timeout_ms,
      })) {
        yield waitResult;
      }
    },
    toModelOutput: stripAnsi,
  })),

  read_file: toolWithCompute(({ client }) =>
    tool({
      description: `Reads a file from the workspace filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The path parameter can be a relative path or an absolute path
- By default, it reads up to ${limits.readLineLimit} lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than ${limits.readLineLengthLimit} characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Blink to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Blink is a multimodal LLM
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/123/abc/T/TemporaryItems/NSIRD_screencaptureui_ZfB1tD/Screenshot.png
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
      inputSchema: z.object({
        file_path: z.string(),
        line_offset: z.number(),
        line_limit: z.number(),
      }),
      execute: async (args, opts) => {
        const result = await (
          await client()
        ).request(
          "read_file",
          {
            path: args.file_path,
            line_start: args.line_offset,
            line_end: args.line_offset + args.line_limit,
          },
          {
            signal: opts.abortSignal,
          }
        );
        return result;
      },
      toModelOutput: (output) => {
        if (output.mime_type?.startsWith("image/")) {
          return {
            type: "content",
            value: [
              {
                type: "media",
                data: output.content,
                mediaType: output.mime_type,
              },
            ],
          };
        }
        return {
          type: "json",
          value: output,
        };
      },
    })
  ),

  write_file: toolWithCompute(({ client }) => ({
    description: "Write a file to the filesystem.",
    inputSchema: z.object({
      file_path: z.string(),
      content: z.string(),
    }),
    execute: async (args, opts) => {
      await (
        await client()
      ).request(
        "write_file",
        {
          path: args.file_path,
          content: args.content,
        },
        {
          signal: opts.abortSignal,
        }
      );
    },
  })),

  read_directory: toolWithCompute(({ client }) =>
    tool({
      description: `Reads a directory from the workspace filesystem.`,
      inputSchema: z.object({
        directory_path: z.string(),
      }),
      execute: async (args, opts) => {
        return (await client()).request("read_directory", {
          path: args.directory_path,
        });
      },
    })
  ),

  edit_file: toolWithCompute(({ client: promiseClient }) => ({
    description: `This is a tool for making multiple edits to a single file in one operation. It is built on top of the "workspace_edit_file" tool and allows you to perform multiple find-and-replace operations efficiently. Prefer this tool over the "workspace_edit_file" tool when you need to make multiple edits to the same file.

Before using this tool:

1. Use the "workspace_read_file" tool to understand the file's contents and context
2. Verify the directory path is correct

To make multiple file edits, provide the following:
1. file_path: The path to the file to modify (can be relative or absolute)
2. edits: An array of edit operations to perform, where each edit contains:
- old_string: The text to replace (must match the file contents exactly, including all whitespace and indentation)
- new_string: The edited text to replace the old_string
- expected_replacements: The number of replacements you expect to make. Defaults to 1 if not specified.

IMPORTANT:
- All edits are applied in sequence, in the order they are provided
- Each edit operates on the result of the previous edit
- All edits must be valid for the operation to succeed - if any edit fails, none will be applied
- This tool is ideal when you need to make several changes to different parts of the same file

CRITICAL REQUIREMENTS:
1. The edits are atomic - either all succeed or none are applied
2. Plan your edits carefully to avoid conflicts between sequential operations

WARNING:
- The tool will fail if edits.old_string matches multiple locations and edits.expected_replacements isn't specified
- The tool will fail if the number of matches doesn't equal edits.expected_replacements when it's specified
- The tool will fail if edits.old_string doesn't match the file contents exactly (including whitespace)
- The tool will fail if edits.old_string and edits.new_string are the same
- Since edits are applied in sequence, ensure that earlier edits don't affect the text that later edits are trying to find

When making edits:
- Ensure all edits result in idiomatic, correct code
- Do not leave the code in a broken state

If you want to create a new file, use:
- A new file path, including dir name if needed
- First edit: empty old_string and the new file's contents as new_string
- Subsequent edits: normal edit operations on the created content`,
    inputSchema: z.object({
      file_path: z.string(),
      edits: z.array(
        z.object({
          old_string: z.string(),
          new_string: z.string(),
          expected_replacements: z.number(),
        })
      ),
    }),
    execute: async (args, opts) => {
      const client = await promiseClient();
      let file: string;
      try {
        const content = await client.request(
          "read_file",
          {
            path: args.file_path,
          },
          {
            signal: opts.abortSignal,
          }
        );
        file = content.content;
      } catch (err) {
        // TODO: Handle based on error type.
        file = args.edits[0]!.new_string;
        if (args.edits.length > 0 && args.edits[0]!.old_string === "") {
          file = args.edits[0]!.new_string;
          args.edits.shift();
        } else {
          throw new Error(
            `input is invalid: File does not exist and first edit is not for file creation.\nFile: ${args.file_path}`
          );
        }
      }

      let newFile = file;
      let edits: {
        old_string: string;
        new_string: string;
      }[] = [];

      // First, validate all edits before applying any
      for (const edit of args.edits) {
        const expectedReplacements = edit.expected_replacements ?? 1;
        const oldString = edit.old_string;
        const newString = edit.new_string;

        // Check if old_string and new_string are the same
        if (oldString === newString) {
          throw new Error(
            `input is invalid: old_string and new_string are identical.\nString: ${oldString}`
          );
        }

        // Count occurrences using literal string matching (not regex)
        const occurrences = countStringOccurrences(newFile, oldString);

        // Check if string is found at all
        if (occurrences === 0) {
          throw new Error(
            `input is invalid: String to replace not found in file.\nString: ${oldString}`
          );
        }

        // Check if number of occurrences matches expected
        if (occurrences !== expectedReplacements) {
          throw new Error(
            `input is invalid: Found ${occurrences} matches of the string to replace, but expected ${expectedReplacements}. The number of actual matches must equal the expected replacements. Please adjust your string to match or update the expected count.\nString: ${oldString}`
          );
        }
      }

      // Apply all edits sequentially
      for (const edit of args.edits) {
        const oldString = edit.old_string;
        const newString = edit.new_string;

        // Replace all occurrences of oldString with newString
        newFile = replaceAllOccurrences(newFile, oldString, newString);

        edits.push({
          old_string: oldString,
          new_string: newString,
        });
      }

      await client.request(
        "write_file",
        {
          path: args.file_path,
          content: newFile,
        },
        {
          signal: opts.abortSignal,
        }
      );

      const patch = structuredPatch(
        args.file_path,
        args.file_path,
        file,
        newFile
      );
      return {
        edits,
        file_path: args.file_path,
        structured_patch: patch.hunks.map((hunk) => ({
          old_start: hunk.oldStart,
          old_end: hunk.oldLines,
          new_start: hunk.newStart,
          new_end: hunk.newLines,
          lines: hunk.lines,
        })),
      };
    },
  })),

  process_grep_output: toolWithCompute(({ client }) => ({
    description: `Search through the output of a running or completed process. **This is the PRIMARY tool for analyzing command output** - use this instead of piping commands to grep, tail, or re-running commands with filters.

Use this for:
- Finding test failures and error messages
- Searching logs for specific patterns
- Extracting relevant information from verbose output
- Analyzing build or test results

Example: After running tests with \`workspace_bash\`, use this to find all FAIL: lines rather than re-running the test command.`,
    inputSchema: z.object({
      pid: z.number(),
      pattern: z.string(),
      before_lines: z.number(),
      after_lines: z.number(),
    }),
    execute: async (args, opts) => {
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern);
      } catch (err) {
        throw new Error(`Invalid regex pattern: ${args.pattern}`);
      }

      const { lines } = await (
        await client()
      ).request(
        "process_read_plain_output",
        {
          pid: args.pid,
        },
        {
          signal: opts.abortSignal,
        }
      );

      const matches: {
        line_number: number;
        lines: string[];
      }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = line.match(regex);
        if (match) {
          // Calculate the range of lines to include
          const startLine = Math.max(0, i - args.before_lines);
          const endLine = Math.min(lines.length - 1, i + args.after_lines);

          // Extract the lines including context
          const contextLines = lines.slice(startLine, endLine + 1);

          matches.push({
            line_number: i,
            lines: contextLines,
          });
        }
      }

      if (matches.length > 256) {
        throw new Error("Too many matches. Please refine your search.");
      }

      return {
        matches,
        total_matches: matches.length,
      };
    },
  })),
};

export interface ComputeToken {
  readonly id: string;
  readonly token: string;
}

/**
 * experimental_remote is a set of tools for connecting to remote compute instances.
 *
 * This is functional but very early. Use with caution.
 */
export const experimental_remote = {
  /**
   * token generates a token for a remote compute instance.
   *
   * Use this with `BLINK_TOKEN=<token> blink compute serve`
   * to start a compute instance.
   */
  token: async (): Promise<ComputeToken> => {
    const resp = await fetch("https://blink.coder.com/api/tools/compute", {
      method: "POST",
    });
    if (resp.status !== 201) {
      throw new Error("Failed to generate compute token");
    }
    const data = (await resp.json()) as ComputeToken;
    return data;
  },

  /**
   * connect returns a client connected to the remote compute instance.
   */
  connect: async (id: string): Promise<Client> => {
    // Connect to the remote compute instance. This will throw an error
    // if the connection fails.
    const url = new URL(`wss://blink.so/api/tools/compute/connect?id=${id}`);
    const ws = new WebSocket(url.toString());
    return new Promise<Client>((resolve, reject) => {
      const client = new Client({
        send: (message) => {
          if (ws.readyState !== WebSocket.OPEN) {
            client.dispose("connection closed");
            return;
          }
          ws.send(message);
        },
      });
      ws.onmessage = (event) => {
        client.handleMessage(event.data as string);
      };
      ws.onopen = () => {
        resolve(client);
      };
      ws.onerror = (event) => {
        client.dispose("connection error");
        reject(event);
      };
    });
  },
};

const doProcessWait = async function* ({
  client,
  pid,
  abortSignal,
  timeoutMs,
}: {
  client: Client;
  pid: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): AsyncGenerator<ProcessWaitResult> {
  const resolvedClient = await client;
  const results: ProcessWaitResult[] = [];
  let resolveNext: (() => void) | null = null;
  let completed = false;
  let error: any = null;

  let currentOutput = "";
  const listener = resolvedClient.onNotification(
    "process_output",
    (payload) => {
      if (payload.pid === pid) {
        currentOutput += payload.output;
        results.push({ pid, ansiOutput: currentOutput });
        resolveNext?.();
      }
    }
  );

  // Start the process_wait request
  const waitPromise = resolvedClient
    .request(
      "process_wait",
      {
        pid: pid,
        output_idle_timeout_ms: 3_000,
        timeout_ms: timeoutMs ?? 25_000,
      },
      { signal: abortSignal }
    )
    .then((resp) => {
      results.push({
        pid: resp.pid,
        title: resp.title,
        command: resp.command,
        args: resp.args,
        cwd: resp.cwd,
        env: resp.env,
        ansiOutput: resp.ansi_output,
        plainOutput: {
          totalLines: resp.plain_output.total_lines,
          lines: resp.plain_output.lines,
        },
        durationMs: resp.duration_ms,
        exitCode: resp.exit_code,
        exitSignal: resp.exit_signal,
        stillRunning:
          typeof resp.exit_code !== "number" &&
          typeof resp.exit_signal !== "number",
      });
      completed = true;
      resolveNext?.();
    })
    .catch((err) => {
      error = err;
      completed = true;
      resolveNext?.();
    });

  try {
    while (!completed || results.length > 0) {
      if (error) throw error;

      if (results.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        resolveNext = null;
      }

      while (results.length > 0) {
        yield results.shift()!;
      }
    }

    await waitPromise;
  } finally {
    listener.dispose();
  }
};

const processWaitResultSchema = z.union([
  // Minimal version with just pid and ansiOutput
  z.object({
    pid: z.number(),
    ansiOutput: z.string(),
  }),
  // Full version with all fields
  z.object({
    pid: z.number(),
    title: z.string().optional(),
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    env: z.record(z.string(), z.string()),
    ansiOutput: z.string(),
    plainOutput: z.object({
      totalLines: z.number(),
      lines: z.array(z.string()),
    }),
    durationMs: z.number(),
    exitCode: z.number().optional(),
    exitSignal: z.number().optional(),
    stillRunning: z.boolean(),
  }),
]);

type ProcessWaitResult = z.infer<typeof processWaitResultSchema>;

// Helper functions for string operations
const countStringOccurrences = (text: string, searchString: string): number => {
  if (searchString.length === 0) return 0;
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(searchString, position)) !== -1) {
    count++;
    position += searchString.length;
  }
  return count;
};

const replaceAllOccurrences = (
  text: string,
  searchString: string,
  replaceString: string
): string => {
  if (searchString.length === 0) return text;
  return text.split(searchString).join(replaceString);
};
