import { z } from "zod";

const TaskStatusSchema = z.enum([
  "pending",
  "initializing",
  "active",
  "paused",
  "unknown",
  "error",
]);

const TaskStateSchema = z.enum(["working", "idle", "complete", "failed"]);

const TaskStateEntrySchema = z.object({
  timestamp: z.string(),
  state: TaskStateSchema,
  message: z.string(),
  uri: z.string(),
});

const NullableUUIDSchema = z.object({
  uuid: z.string(),
  valid: z.boolean(),
});

const WorkspaceAgentHealthSchema = z
  .object({
    healthy: z.boolean(),
    reason: z.string().optional(),
  })
  .nullable()
  .optional();

const TaskSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  owner_id: z.string(),
  owner_name: z.string(),
  owner_avatar_url: z.string().optional(),
  name: z.string(),
  display_name: z.string(),
  template_id: z.string(),
  template_version_id: z.string(),
  template_name: z.string(),
  template_display_name: z.string(),
  template_icon: z.string(),
  workspace_id: NullableUUIDSchema.optional(),
  workspace_name: z.string().optional(),
  workspace_status: z.string().optional(),
  workspace_build_number: z.number().optional(),
  workspace_agent_id: NullableUUIDSchema.optional(),
  workspace_agent_lifecycle: z.string().nullable().optional(),
  workspace_agent_health: WorkspaceAgentHealthSchema,
  workspace_app_id: NullableUUIDSchema.optional(),
  initial_prompt: z.string(),
  status: TaskStatusSchema,
  current_state: TaskStateEntrySchema.nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const TasksListResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  count: z.number(),
});

const TaskLogEntrySchema = z.object({
  id: z.number(),
  content: z.string(),
  time: z.string(),
  type: z.string(),
});

const TaskLogsResponseSchema = z.object({
  logs: z.array(TaskLogEntrySchema),
  snapshot: z.boolean().optional(),
  snapshot_at: z.string().optional(),
});

const CoderApiErrorSchema = z.object({
  message: z.string(),
  detail: z.string().optional(),
});

export type TaskStatus =
  | "pending"
  | "initializing"
  | "active"
  | "paused"
  | "unknown"
  | "error";

export type TaskState = "working" | "idle" | "complete" | "failed";

export interface TaskStateEntry {
  timestamp: string;
  state: TaskState;
  message: string;
  uri: string;
}

export interface Task {
  id: string;
  organization_id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  display_name: string;
  template_id: string;
  template_version_id: string;
  template_name: string;
  template_display_name: string;
  template_icon: string;
  workspace_id?: { uuid: string; valid: boolean };
  workspace_name?: string;
  workspace_status?: string;
  workspace_agent_id?: { uuid: string; valid: boolean };
  workspace_agent_lifecycle?: string | null;
  workspace_agent_health?: { healthy: boolean; reason?: string } | null;
  workspace_app_id?: { uuid: string; valid: boolean };
  initial_prompt: string;
  status: TaskStatus;
  current_state?: TaskStateEntry | null;
  created_at: string;
  updated_at: string;
}

export interface TaskLogEntry {
  id: number;
  content: string;
  time: string;
  type: string;
}

export interface CreateTaskRequest {
  template_version_id: string;
  template_version_preset_id?: string;
  input: string;
  name?: string;
  display_name?: string;
}

export class CoderTasksClient {
  private readonly baseUrl: string;
  private readonly sessionToken: string;

  constructor(baseUrl: string, sessionToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sessionToken = sessionToken;
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Coder-Session-Token": this.sessionToken,
      Accept: "application/json",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorBody = CoderApiErrorSchema.safeParse(await response.json());
        if (errorBody.success) {
          errorMessage = errorBody.data.message || errorMessage;
          if (errorBody.data.detail) {
            errorMessage += ` - ${errorBody.data.detail}`;
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMessage);
    }

    if (response.status === 202 || response.status === 204) {
      return undefined as T;
    }

    const json = await response.json();
    return schema.parse(json);
  }

  async createTask(user: string, req: CreateTaskRequest): Promise<Task> {
    return this.request(
      "POST",
      `/api/v2/tasks/${encodeURIComponent(user)}`,
      TaskSchema,
      req
    );
  }

  async listTasks(query?: string): Promise<Task[]> {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    const resp = await this.request(
      "GET",
      `/api/v2/tasks${params}`,
      TasksListResponseSchema
    );
    return resp.tasks;
  }

  async getTask(user: string, task: string): Promise<Task> {
    return this.request(
      "GET",
      `/api/v2/tasks/${encodeURIComponent(user)}/${encodeURIComponent(task)}`,
      TaskSchema
    );
  }

  async getTaskLogs(
    user: string,
    task: string
  ): Promise<{ logs: TaskLogEntry[]; snapshot?: boolean; snapshot_at?: string }> {
    return this.request(
      "GET",
      `/api/v2/tasks/${encodeURIComponent(user)}/${encodeURIComponent(task)}/logs`,
      TaskLogsResponseSchema
    );
  }

  async sendTaskInput(
    user: string,
    task: string,
    input: string
  ): Promise<void> {
    await this.request(
      "POST",
      `/api/v2/tasks/${encodeURIComponent(user)}/${encodeURIComponent(task)}/send`,
      z.void(),
      { input }
    );
  }

  async pauseTask(user: string, task: string): Promise<void> {
    await this.request(
      "POST",
      `/api/v2/tasks/${encodeURIComponent(user)}/${encodeURIComponent(task)}/pause`,
      z.void()
    );
  }

  async deleteTask(user: string, task: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/v2/tasks/${encodeURIComponent(user)}/${encodeURIComponent(task)}`,
      z.void()
    );
  }
}
