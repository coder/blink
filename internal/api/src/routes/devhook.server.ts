import { validate } from "uuid";
import type { APIServer } from "../server";
import { createWebhookURL } from "../server-helper";

export default function mountDevhook(server: APIServer) {
  server.get("/:devhook/url", async (c) => {
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

  server.get("/:devhook", async (c) => {
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
