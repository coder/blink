import { validate } from "uuid";
import { withDevhookAuth } from "../middleware";
import type { APIServer } from "../server";
import { createWebhookURL } from "../server-helper";

export default function mountDevhook(server: APIServer) {
  // this endpoint is used by packages/server/src/server.ts
  // to authorize the listen request. it must use the exact same auth
  // method as the one required to listen on the matching devhook URL.
  server.get("/:devhook/url", withDevhookAuth, async (c) => {
    const id = c.req.param("devhook");
    if (!validate(id)) {
      return c.json({ message: "Invalid devhook ID" }, 400);
    }
    if (!c.env.devhook) {
      return c.json({ message: "Devhook not enabled" }, 500);
    }
    const db = await c.env.database();
    const agent = await db.selectAgentDeploymentByRequestID(id);
    if (agent) {
      return c.json({ message: "Devhook already used by an agent" }, 400);
    }
    const url = createWebhookURL(c.env, id, "").replace(/\/$/, "");
    return c.json({ url });
  });

  // this endpoint is somewhat misleading. in self-hosted mode,
  // it's not used during the flow to listen on the devhook URL.
  // websocket upgrade logic is handled in packages/server/src/server.ts
  server.get("/:devhook", withDevhookAuth, async (c) => {
    const id = c.req.param("devhook");
    if (!validate(id)) {
      return c.json({ message: "Invalid devhook ID" }, 400);
    }
    if (!c.env.devhook) {
      return c.json({ message: "Devhook not enabled" }, 500);
    }
    // Check if it's already used by an agent.
    const db = await c.env.database();
    const agent = await db.selectAgentDeploymentByRequestID(id);
    if (agent) {
      return c.json({ message: "Devhook already used by an agent" }, 400);
    }
    return c.env.devhook.handleListen(id, c.req.raw);
  });
}
