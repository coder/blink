import type { ChatRunWithStatus as DBChatRunWithStatus } from "@blink.so/database/schema";
import { withAuth, withCursorPagination } from "../../middleware";
import type { APIServer } from "../../server";
import { withChatURLParam } from "./chats.server";
import type { ChatRun, ListChatRunsResponse } from "./runs.client";

export default function mountChatRuns(app: APIServer) {
  // List runs for a chat.
  app.get("/", withAuth, withChatURLParam, withCursorPagination, async (c) => {
    const db = await c.env.database();
    const runs = await db.selectChatRuns({
      chatID: c.get("chat").id,
      cursor: c.get("cursor"),
      limit: c.get("limit"),
    });
    const resp: ListChatRunsResponse = {
      items: runs.items.map(convertChatRun),
      next_cursor: runs.next_cursor,
    };
    return c.json(resp);
  });

  // Get a run by ID.
  app.get("/:id", withAuth, withChatURLParam, async (c) => {
    const db = await c.env.database();
    const run = await db.selectChatRun(c.req.param("id"));
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    if (run.chat_id !== c.get("chat").id) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(convertChatRun(run));
  });
}

const convertChatRun = (run: DBChatRunWithStatus): ChatRun => {
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
