import type {
  ChatRunStepStatus,
  ChatRunStepWithStatus,
} from "@blink.so/database/schema";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import z from "zod";
import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
  withCursorPagination,
} from "../../middleware";
import type { APIServer } from "../../server";
import {
  schemaChatRunStepStatus,
  type ChatRunStepSummary,
} from "../chats/steps.client";
import {
  type AgentRunStep,
  type ListAgentRunStepsResponse,
} from "./steps.client";

export default function mountSteps(app: APIServer) {
  // List steps for an agent.
  app.get(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    withCursorPagination,
    validator("query", (value) => {
      if (Array.isArray(value["deployment_id"])) {
        throw new HTTPException(400, {
          message: "deployment_id must not be supplied multiple times",
        });
      }
      if (Array.isArray(value["chat_id"])) {
        throw new HTTPException(400, {
          message: "chat_id must not be supplied multiple times",
        });
      }
      if (Array.isArray(value["run_id"])) {
        throw new HTTPException(400, {
          message: "run_id must not be supplied multiple times",
        });
      }

      const deployment_id = value["deployment_id"];
      if (deployment_id && !z.uuid().safeParse(deployment_id).success) {
        throw new HTTPException(400, {
          message: "deployment_id must be a valid UUID",
        });
      }
      const chat_id = value["chat_id"];
      if (chat_id && !z.uuid().safeParse(chat_id).success) {
        throw new HTTPException(400, {
          message: "chat_id must be a valid UUID",
        });
      }
      const run_id = value["run_id"];
      if (run_id && !z.uuid().safeParse(run_id).success) {
        throw new HTTPException(400, {
          message: "run_id must be a valid UUID",
        });
      }
      const status = value["status"];
      if (status && !schemaChatRunStepStatus.safeParse(status).success) {
        throw new HTTPException(400, {
          message: "status must be a valid chat run step status",
        });
      }

      return {
        deployment_id,
        chat_id,
        run_id,
        status: status as ChatRunStepStatus,
      };
    }),
    async (c) => {
      const db = await c.env.database();
      const permission = c.get("agent_permission");
      const userId = c.get("user_id");

      // Read users can only see steps from their own chats
      let chatIds: string[] | undefined;
      if (permission === "read") {
        const chats = await db.selectChats({
          agentID: c.get("agent").id,
        });
        // Filter to only chats created by this user
        chatIds = chats.items
          .filter((chat) => chat.created_by === userId)
          .map((chat) => chat.id);
      }

      const steps = await db.selectAgentSteps({
        agent_id: c.get("agent").id,
        agent_deployment_id: c.req.valid("query").deployment_id,
        chat_id: c.req.valid("query").chat_id,
        run_id: c.req.valid("query").run_id,
        status: c.req.valid("query").status,
        chat_ids: chatIds,
        cursor: c.get("cursor"),
        limit: c.get("limit"),
      });

      const response: ListAgentRunStepsResponse = {
        next_cursor: steps.next_cursor,
        items: steps.items.map(convertChatRunStepToSummary),
      };

      return c.json(response);
    }
  );

  // Get a step for an agent.
  app.get(
    "/:step_id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      const id = c.req.param("step_id");
      if (!z.uuid().safeParse(id).success) {
        throw new HTTPException(400, {
          message: "step_id must be a valid UUID",
        });
      }
      const db = await c.env.database();
      const step = await db.selectAgentStep({
        agent_id: c.get("agent").id,
        step_id: id,
      });
      if (!step) {
        throw new HTTPException(404, {
          message: "Step not found",
        });
      }

      return c.json(convertChatRunStep(step));
    }
  );
}

const convertChatRunStep = (step: ChatRunStepWithStatus): AgentRunStep => {
  return {
    id: step.id,
    number: step.number,
    chat_id: step.chat_id,
    chat_run_id: step.chat_run_id,
    agent_id: step.agent_id,
    agent_deployment_id: step.agent_deployment_id,
    continuation_reason: step.continuation_reason,
    error: step.error,
    response_status: step.response_status,
    response_message_id: step.response_message_id,
    started_at: step.started_at.toISOString(),
    status: step.status,
    heartbeat_at: step.heartbeat_at,
    completed_at: step.completed_at,
    interrupted_at: step.interrupted_at,
    first_message_id: step.first_message_id,
    last_message_id: step.last_message_id,
    response_headers: step.response_headers,
    response_headers_redacted: step.response_headers_redacted,
    response_body: step.response_body,
    response_body_redacted: step.response_body_redacted,
    time_to_first_token_micros: step.time_to_first_token_micros,
    usage_model: step.usage_model,
    usage_total_input_tokens: step.usage_total_input_tokens,
    usage_total_output_tokens: step.usage_total_output_tokens,
    usage_total_tokens: step.usage_total_tokens,
    usage_total_cached_input_tokens: step.usage_total_cached_input_tokens,
    usage_cost_usd: step.usage_cost_usd,
  };
};

const convertChatRunStepToSummary = (
  step: ChatRunStepWithStatus
): ChatRunStepSummary => {
  return {
    id: step.id,
    number: step.number,
    chat_id: step.chat_id,
    chat_run_id: step.chat_run_id,
    agent_id: step.agent_id,
    agent_deployment_id: step.agent_deployment_id,
    continuation_reason: step.continuation_reason,
    error: step.error,
    response_status: step.response_status,
    response_message_id: step.response_message_id,
    started_at: step.started_at.toISOString(),
    status: step.status,
    time_to_first_token_micros: step.time_to_first_token_micros,
  };
};
