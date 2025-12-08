import { validator } from "hono/validator";
import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
} from "../../middleware";
import type { APIServer } from "../../server";
import { schemaGetAgentLogsRequest } from "./logs.client";

// /api/agents/:id/logs
export default function mountAgentLogs(app: APIServer) {
  app.get(
    "/",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("query", (data) => {
      return schemaGetAgentLogsRequest.parse(data);
    }),
    async (c) => {
      const reqData = c.req.valid("query");
      const agent = c.get("agent");

      const logs = await c.env.logs.get({
        agent_id: agent.id,
        start_time: reqData.start_time,
        end_time: reqData.end_time,
        limit: reqData.limit ?? 200,
        message_pattern: reqData.message_pattern,
        filters: reqData.filters,
      });

      return c.json({ logs });
    }
  );
}
