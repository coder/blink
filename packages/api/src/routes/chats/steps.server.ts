import type { ChatRunStepWithStatus } from "@blink.so/database/schema";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import z from "zod";
import { withAuth, withCursorPagination } from "../../middleware";
import type { APIServer } from "../../server";
import { withChatURLParam } from "./chats.server";
import type {
  ChatRunStep,
  ChatRunStepSummary,
  ListChatRunStepsResponse,
} from "./steps.client";

export default function mountChatSteps(app: APIServer) {
  // List steps for a chat.
  app.get(
    "/",
    withAuth,
    withChatURLParam,
    withCursorPagination,
    validator("query", (value) => {
      if (Array.isArray(value["run_id"])) {
        throw new HTTPException(400, {
          message: "run_id must not be supplied multiple times",
        });
      }
      const run_id = value["run_id"];
      if (run_id && !z.uuid().safeParse(run_id).success) {
        throw new HTTPException(400, {
          message: "run_id must be a valid UUID",
        });
      }
      return { run_id };
    }),
    async (c) => {
      const db = await c.env.database();
      const steps = await db.selectChatSteps({
        chat_id: c.get("chat").id,
        run_id: c.req.valid("query").run_id,
        cursor: c.get("cursor"),
        limit: c.get("limit"),
      });

      const response: ListChatRunStepsResponse = {
        next_cursor: steps.next_cursor,
        items: steps.items.map(convertChatRunStepToSummary),
      };

      return c.json(response);
    }
  );

  // Get a step for a chat.
  app.get("/:step_id", withAuth, withChatURLParam, async (c) => {
    const id = c.req.param("step_id");
    if (!z.uuid().safeParse(id).success) {
      throw new HTTPException(400, {
        message: "step_id must be a valid UUID",
      });
    }
    const db = await c.env.database();
    const step = await db.selectChatRunStepByID(id);
    if (!step || step.chat_id !== c.get("chat").id) {
      throw new HTTPException(404, {
        message: "Step not found",
      });
    }

    return c.json(convertChatRunStep(step));
  });
}

const convertChatRunStep = (step: ChatRunStepWithStatus): ChatRunStep => {
  return {
    id: step.id,
    number: step.number,
    chat_id: step.chat_id,
    chat_run_id: step.chat_run_id,
    agent_id: step.agent_id!,
    agent_deployment_id: step.agent_deployment_id!,
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
    agent_id: step.agent_id!,
    agent_deployment_id: step.agent_deployment_id!,
    continuation_reason: step.continuation_reason,
    error: step.error,
    response_status: step.response_status,
    response_message_id: step.response_message_id,
    started_at: step.started_at.toISOString(),
    status: step.status,
    time_to_first_token_micros: step.time_to_first_token_micros,
  };
};
