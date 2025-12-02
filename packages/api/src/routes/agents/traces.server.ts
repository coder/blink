import { validator } from "hono/validator";
import {
  withAgentPermission,
  withAgentURLParam,
  withAuth,
} from "../../middleware";
import type { APIServer } from "../../server";
import { SpansRequestSchema } from "./traces.client";

// /api/agents/:id/traces/spans
export default function mountAgentTraces(app: APIServer) {
  app.get(
    "/spans",
    withAuth,
    withAgentURLParam,
    withAgentPermission("write"),
    validator("query", (data) => {
      return SpansRequestSchema.parse(data);
    }),
    async (c) => {
      const reqData = c.req.valid("query");
      const agent = c.get("agent");

      const traces = await c.env.traces.read({
        agent_id: agent.id,
        start_time: reqData.start_time,
        end_time: reqData.end_time,
        limit: reqData.limit ?? 200,
        filters: reqData.filters,
      });

      return c.json({ traces });
    }
  );
}
