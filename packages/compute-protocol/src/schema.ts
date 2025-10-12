import { z } from "zod";

export interface Disposable {
  dispose(reason?: string): void;
}

// createMessagePayload is a helper function to create a message payload.
// It's used to create messages that are sent over the wire.
export const createMessagePayload = (
  type: ClientMessageType | ServerMessageType,
  payload: Uint8Array
) => {
  const arr = new Uint8Array(1 + payload.length);
  arr[0] = type;
  arr.set(payload, 1);
  return arr;
};

export const createWebSocketMessagePayload = (
  payload: string | Uint8Array | ArrayBuffer,
  encoder: TextEncoder
) => {
  const isText = typeof payload === "string";
  if (typeof payload === "string") {
    payload = encoder.encode(payload);
  }

  const arr = new Uint8Array(1 + payload.byteLength);
  arr[0] = isText ? 0x00 : 0x01;
  arr.set(new Uint8Array(payload), 1);
  return arr;
};

export const parseWebSocketMessagePayload = (
  payload: Uint8Array,
  decoder: TextDecoder
): string | Uint8Array => {
  if (payload[0] === 0x00) {
    return decoder.decode(payload.subarray(1));
  }
  return new Uint8Array(payload.subarray(1));
};

export enum ClientMessageType {
  REQUEST = 0x00,
  PROXY_INIT = 0x01,
  PROXY_BODY = 0x02,
  PROXY_WEBSOCKET_MESSAGE = 0x03,
  PROXY_WEBSOCKET_CLOSE = 0x04,
}

export enum ServerMessageType {
  RESPONSE = 0x00,
  NOTIFICATION = 0x01,
  PROXY_INIT = 0x02,
  PROXY_DATA = 0x03,
  PROXY_WEBSOCKET_MESSAGE = 0x04,
  PROXY_WEBSOCKET_CLOSE = 0x05,
}

export const ClientMessageSchema = {
  [ClientMessageType.REQUEST]: z.string(),
  [ClientMessageType.PROXY_INIT]: z.object({
    method: z.string(),
    headers: z.record(z.string(), z.string()),
    url: z.string(),
  }),
  [ClientMessageType.PROXY_BODY]: z.instanceof(Uint8Array),
  [ClientMessageType.PROXY_WEBSOCKET_MESSAGE]: z.object({
    type: z.enum(["text", "binary"]),
    data: z.instanceof(Uint8Array),
  }),
  [ClientMessageType.PROXY_WEBSOCKET_CLOSE]: z.object({
    code: z.number().optional(),
    reason: z.string().optional(),
  }),
};

export type ClientMessage<T extends keyof typeof ClientMessageSchema> = z.infer<
  (typeof ClientMessageSchema)[T]
>;

export const ServerMessageSchema = {
  [ServerMessageType.RESPONSE]: z.string(),
  [ServerMessageType.NOTIFICATION]: z.string(),
  [ServerMessageType.PROXY_INIT]: z.object({
    status_code: z.number(),
    status_message: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
  [ServerMessageType.PROXY_DATA]: z.instanceof(Uint8Array),
  [ServerMessageType.PROXY_WEBSOCKET_MESSAGE]: z.instanceof(Uint8Array),
  [ServerMessageType.PROXY_WEBSOCKET_CLOSE]: z.object({
    code: z.number(),
    reason: z.string(),
  }),
};

export type ServerMessage<T extends keyof typeof ServerMessageSchema> = z.infer<
  (typeof ServerMessageSchema)[T]
>;

export const ProxySchema = {
  [ClientMessageType.PROXY_INIT]: {
    method: z.string(),
    headers: z.record(z.string(), z.string()),
    url: z.string(),
  },
};

export const RequestSchema = {
  process_execute: z.object({
    command: z.string(),
    args: z.array(z.string()),

    env_file: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  }),

  process_send_input: z.object({
    pid: z.number(),
    data: z.string(),
  }),

  process_wait: z.object({
    pid: z.number(),

    // Refer to ExecuteRequestSchema.output_idle_timeout_ms.
    output_idle_timeout_ms: z.number().optional(),

    // Refer to ExecuteRequestSchema.timeout_ms.
    timeout_ms: z.number().optional(),
  }),

  process_list: z.object({
    include_dead: z.boolean().optional(),
  }),

  process_read_plain_output: z.object({
    pid: z.number(),
    start_line: z.number().optional(),
    end_line: z.number().optional(),
  }),

  process_kill: z.object({
    pid: z.number(),
    signal: z.string().optional(),
  }),

  set_env: z.object({
    env: z.record(z.string(), z.string()),
  }),

  read_file: z.object({
    path: z.string(),
    line_start: z.number().optional(),
    line_end: z.number().optional(),
  }),

  write_file: z.object({
    path: z.string(),
    content: z.string(),
    base64: z.boolean().optional(),
    mode: z.number().optional(),
  }),

  read_directory: z.object({
    path: z.string(),
  }),

  watch_directory: z.object({
    path: z.string(),
  }),

  deploy_static_files: z.object({
    path: z.string(),
  }),
};

export const ProcessStatusSchema = z.object({
  pid: z.number(),
  command: z.string(),
  args: z.array(z.string()),
  title: z.string().optional(),
  cwd: z.string(),
  env: z.record(z.string(), z.string()),
  exit_code: z.number().optional(),
  exit_signal: z.number().optional(),
  duration_ms: z.number().optional(),
  output_total_lines: z.number(),
});

export type ProcessStatus = z.infer<typeof ProcessStatusSchema>;

export const ProcessWaitSchema = ProcessStatusSchema.extend({
  // ansi_output returns the output from the command
  // until the point-in-time where execute exits.
  ansi_output: z.string(),
  // until the point-in-time where execute exits.
  plain_output: z.object({
    lines: z.array(z.string()),
    total_lines: z.number(),
  }),
});

export const ResponseSchema = {
  process_execute: z.object({
    pid: z.number(),
  }),
  process_send_input: z.object({}),
  process_wait: ProcessWaitSchema,
  process_list: z.object({
    processes: z.array(ProcessStatusSchema),
  }),
  process_read_plain_output: z.object({
    lines: z.array(z.string()),
    total_lines: z.number(),
    duration_ms: z.number(),
    exit_code: z.number().optional(),
    exit_signal: z.number().optional(),
  }),
  process_kill: z.object({}),
  set_env: z.object({}),
  read_file: z.object({
    total_lines: z.number(),
    lines_read: z.number(),
    start_line: z.number(),
    content: z.string(),
    mime_type: z.string(),
  }),
  write_file: z.object({}),
  read_directory: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["file", "directory", "symlink"]),
      })
    ),
  }),
  watch_directory: z.object({}),
  deploy_static_files: z.object({
    deployment_id: z.string(),
  }),
} satisfies Record<keyof typeof RequestSchema, z.ZodType<any>>;

export const FileChangeEventSchema = z.object({
  type: z.enum(["create", "update", "delete"]),
  path: z.string(),
});

export const DiffLineSchema = z.object({
  type: z.enum(["context", "added", "deleted"]),
  content: z.string(),
  oldLineNumber: z.number().optional(),
  newLineNumber: z.number().optional(),
});

export const DiffChunkSchema = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(DiffLineSchema),
});

export const FileDiffSchema = z.object({
  path: z.string(),
  status: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "untracked",
    "ignored",
    "unmerged",
    "typechange",
  ]),
  oldPath: z.string().optional(),
  insertions: z.number(),
  deletions: z.number(),
  chunks: z.array(DiffChunkSchema),
});

export const DiffSummarySchema = z.object({
  totalFiles: z.number(),
  totalInsertions: z.number(),
  totalDeletions: z.number(),
  netChange: z.number(),
  startHash: z.string().optional(),
  currentHash: z.string().optional(),
  timespan: z.number(),
  files: z.array(FileDiffSchema),
});

export const GitFileStatusSchema = z.object({
  path: z.string(),
  status: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "untracked",
    "ignored",
    "unmerged",
    "typechange",
  ]),
  staged: z.boolean(),
});

export const GitCommitEventSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  author: z.string(),
  email: z.string(),
  date: z.date(),
  timestamp: z.date(),
  filesChanged: z.number(),
  insertions: z.number(),
  deletions: z.number(),
  commitDiff: z.array(FileDiffSchema).optional(),
});

export const GitStatusEventSchema = z.object({
  files: z.array(GitFileStatusSchema),
  branch: z.string(),
  ahead: z.number(),
  behind: z.number(),
  timestamp: z.date(),
  sessionDiff: DiffSummarySchema.optional(),
  workingDirectoryDiff: DiffSummarySchema.optional(),
  newCommits: z.array(GitCommitEventSchema),
  currentCommit: z
    .object({
      hash: z.string(),
      shortHash: z.string(),
      message: z.string(),
      author: z.string(),
      date: z.date(),
    })
    .optional(),
  diffSkipped: z.boolean().optional(),
  payloadTruncated: z.boolean().optional(),
  estimatedSizeKB: z.number().optional(),
});

export const WatchOptionsSchema = z.object({
  debounceDelay: z.number().optional(),
  gitStatusInterval: z.number().optional(),
  ignoreDotfiles: z.boolean().optional(),
  ignored: z.array(z.string()).optional(),
  watchGit: z.boolean().optional(),
  includeDiffs: z.boolean().optional(),
  maxDiffFiles: z.number().optional(),
  maxPayloadSizeKB: z.number().optional(),
  truncateLargeDiffs: z.boolean().optional(),
});

// Inferred types from schemas
export type FileChangeEvent = z.infer<typeof FileChangeEventSchema>;
export type DiffLine = z.infer<typeof DiffLineSchema>;
export type DiffChunk = z.infer<typeof DiffChunkSchema>;
export type FileDiff = z.infer<typeof FileDiffSchema>;
export type DiffSummary = z.infer<typeof DiffSummarySchema>;
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;
export type GitCommitEvent = z.infer<typeof GitCommitEventSchema>;
export type GitStatusEvent = z.infer<typeof GitStatusEventSchema>;
export type WatchOptions = z.infer<typeof WatchOptionsSchema>;

export const NotificationSchema = {
  process_status: z.object({
    status: ProcessStatusSchema,
  }),
  process_output: z.object({
    pid: z.number(),
    output: z.string(),
  }),
  file_change: z.object({
    changes: z.array(FileChangeEventSchema),
  }),
  git_status: GitStatusEventSchema,
};

export type RequestMessage<T extends keyof typeof RequestSchema> = {
  type: T;
  id: string;
  jwt?: string;
  payload: z.infer<(typeof RequestSchema)[T]>;
};

export type ResponseMessage<T extends keyof typeof ResponseSchema> = {
  id: string;
  error?: string;
  payload?: z.infer<(typeof ResponseSchema)[T]>;
};

export type NotificationMessage<T extends keyof typeof NotificationSchema> = {
  type: T;
  payload: z.infer<(typeof NotificationSchema)[T]>;
};

export type AnyRequestMessage = {
  [K in keyof typeof RequestSchema]: RequestMessage<K>;
}[keyof typeof RequestSchema];

export type AnyResponseMessage = {
  [K in keyof typeof ResponseSchema]: ResponseMessage<K>;
}[keyof typeof ResponseSchema];

export type AnyNotificationMessage = {
  [K in keyof typeof NotificationSchema]: NotificationMessage<K>;
}[keyof typeof NotificationSchema];
