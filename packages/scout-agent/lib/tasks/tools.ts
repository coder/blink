import { type Tool, tool } from "ai";
import { z } from "zod";
import { CoderTasksClient } from "./client";

export interface TasksConfig {
  /** Coder deployment URL (e.g., https://coder.example.com) */
  url: string;
  /** Session token for the service account that owns tasks */
  sessionToken: string;
  /** Default template version ID for new tasks */
  defaultTemplateVersionId?: string;
  /** Default preset ID for new tasks */
  defaultPresetId?: string;
}

export const createTasksTools = ({
  config,
}: {
  config: TasksConfig;
}): Record<string, Tool> => {
  const client = new CoderTasksClient(config.url, config.sessionToken);
  const user = "me";

  return {
    create_coder_task: tool({
      description:
        "Create a new Coder Task — an autonomous AI coding agent that runs in its own workspace. " +
        "Use this to delegate coding work like implementing features, fixing bugs, writing tests, " +
        "or refactoring code. The task runs independently and you can check its status later.",
      inputSchema: z.object({
        prompt: z
          .string()
          .describe(
            "The instruction/prompt for the AI coding agent. Be specific about what repo, branch, and changes to make."
          ),
        template_version_id: z
          .string()
          .optional()
          .describe(
            "Template version ID to use. Leave blank to use the default."
          ),
        preset_id: z
          .string()
          .optional()
          .describe("Preset ID for the workspace. Leave blank to use the default."),
        name: z
          .string()
          .optional()
          .describe(
            "Optional name for the task. If not provided, one will be generated."
          ),
        display_name: z
          .string()
          .optional()
          .describe("Optional human-readable display name for the task."),
      }),
      execute: async (args) => {
        const templateVersionId =
          args.template_version_id ?? config.defaultTemplateVersionId;
        if (!templateVersionId) {
          throw new Error(
            "No template_version_id provided and no default configured."
          );
        }
        const task = await client.createTask(user, {
          template_version_id: templateVersionId,
          template_version_preset_id:
            args.preset_id ?? config.defaultPresetId,
          input: args.prompt,
          name: args.name,
          display_name: args.display_name,
        });
        return {
          id: task.id,
          name: task.name,
          display_name: task.display_name,
          status: task.status,
          url: `${config.url}/tasks/${task.owner_name}/${task.name}`,
        };
      },
    }),

    list_coder_tasks: tool({
      description:
        "List Coder Tasks. Optionally filter by status (pending, initializing, active, paused, error).",
      inputSchema: z.object({
        status: z
          .enum(["pending", "initializing", "active", "paused", "error", "unknown"])
          .optional()
          .describe("Filter tasks by status."),
      }),
      execute: async (args) => {
        const query = args.status ? `status:${args.status}` : undefined;
        const tasks = await client.listTasks(query);
        return tasks.map((t) => ({
          id: t.id,
          name: t.name,
          display_name: t.display_name,
          status: t.status,
          current_state: t.current_state,
          initial_prompt: t.initial_prompt,
          workspace_name: t.workspace_name,
          url: `${config.url}/tasks/${t.owner_name}/${t.name}`,
          created_at: t.created_at,
          updated_at: t.updated_at,
        }));
      },
    }),

    get_coder_task: tool({
      description:
        "Get the current status and details of a Coder Task by its ID or name.",
      inputSchema: z.object({
        task: z
          .string()
          .describe("The task ID or task name to look up."),
      }),
      execute: async (args) => {
        const task = await client.getTask(user, args.task);
        return {
          id: task.id,
          name: task.name,
          display_name: task.display_name,
          status: task.status,
          current_state: task.current_state,
          initial_prompt: task.initial_prompt,
          workspace_name: task.workspace_name,
          workspace_status: task.workspace_status,
          url: `${config.url}/tasks/${task.owner_name}/${task.name}`,
          created_at: task.created_at,
          updated_at: task.updated_at,
        };
      },
    }),

    get_coder_task_logs: tool({
      description:
        "Get the logs/output from a Coder Task. Use this to see what the AI coding agent has done.",
      inputSchema: z.object({
        task: z
          .string()
          .describe("The task ID or task name."),
      }),
      execute: async (args) => {
        return client.getTaskLogs(user, args.task);
      },
    }),

    send_coder_task_input: tool({
      description:
        "Send additional input/instructions to a running Coder Task. " +
        "Use this to provide follow-up instructions or corrections to the AI coding agent.",
      inputSchema: z.object({
        task: z
          .string()
          .describe("The task ID or task name."),
        input: z
          .string()
          .describe("The message/instruction to send to the task."),
      }),
      execute: async (args) => {
        await client.sendTaskInput(user, args.task, args.input);
        return { success: true };
      },
    }),
  };
};
