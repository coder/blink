import * as convert from "@blink.so/database/convert";
import { withAuth, withOrganizationURLParam } from "../../middleware";
import type { APIServer } from "../../server";
import {
  createAgentRequestURL,
  getAgentUserPermission,
} from "../agents/agents.server";

export default function mountAgents(app: APIServer) {
  app.get("/:agent_name", withAuth, withOrganizationURLParam, async (c) => {
    const name = c.req.param("agent_name");
    const db = await c.env.database();
    const agent = await db.selectAgentByOrganizationIDAndName({
      organizationID: c.get("organization").id,
      name,
    });
    if (!agent) {
      return c.body(null, 404);
    }
    return c.json(
      convert.agent(
        agent,
        await createAgentRequestURL(c, agent),
        await getAgentUserPermission(c, agent)
      )
    );
  });
}
