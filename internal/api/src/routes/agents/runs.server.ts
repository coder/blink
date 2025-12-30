import type { ChatRunWithStatus as DBChatRunWithStatus } from "@blink.so/database/schema";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { validate } from "uuid";
import { z } from "zod";
import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
  withCursorPagination,
} from "../../middleware";
import type { APIServer } from "../../server";
import type { ListChatRunsResponse } from "../chats/runs.client";
import type { AgentRun } from "./runs.client";

export default function mountAgentRuns(app: APIServer) {
  // List runs for an agent.
  app.get(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    withCursorPagination,
    validator("query", (value) => {
      if (Array.isArray(value["agent_deployment_id"])) {
        throw new HTTPException(400, {
          message: "agent_deployment_id must not be supplied multiple times",
        });
      }
      const agent_deployment_id = value["agent_deployment_id"];
      if (
        agent_deployment_id &&
        !z.uuid().safeParse(agent_deployment_id).success
      ) {
        throw new HTTPException(400, {
          message: "agent_deployment_id must be a valid UUID",
        });
      }
      return { agent_deployment_id };
    }),
    async (c) => {
      const db = await c.env.database();
      const permission = c.get("agent_permission");
      const userId = c.get("user_id");

      // Read users can only see runs from their own chats
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

      const runs = await db.selectAgentRuns({
        agent_id: c.get("agent").id,
        agent_deployment_id: c.req.valid("query").agent_deployment_id,
        chat_ids: chatIds,
        cursor: c.get("cursor"),
        limit: c.get("limit"),
      });
      const resp: ListChatRunsResponse = {
        items: runs.items.map(convertAgentRun),
        next_cursor: runs.next_cursor,
      };
      return c.json(resp);
    }
  );

  // Get a run by ID.
  app.get(
    "/:id",
    withAuth,
    withAgentURLParam,
    withAgentPermission("read"),
    async (c) => {
      if (!validate(c.req.param("id"))) {
        return c.json({ error: "Invalid run ID" }, 400);
      }
      const db = await c.env.database();
      const run = await db.selectAgentRun({
        agent_id: c.get("agent").id,
        run_id: c.req.param("id"),
      });
      if (!run) {
        return c.json({ error: "Run not found" }, 404);
      }
      return c.json(convertAgentRun(run));
    }
  );
}

const convertAgentRun = (run: DBChatRunWithStatus): AgentRun => {
  return {
    id: run.id,
    started_at: run.created_at,
    agent_id: run.agent_id,
    agent_deployment_id: run.agent_deployment_id,
    chat_id: run.chat_id,
    step_count: run.last_step_number,
    status: run.status,
    error: run.error,
  };
};
