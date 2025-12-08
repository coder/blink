import { getCookie } from "hono/cookie";
import { decode, encode } from "next-auth/jwt";
import { validate } from "uuid";
import type { APIServer } from "../../server";
import { SESSION_COOKIE_NAME } from "../auth/auth.client";
import type { TokenResponse } from "./compute.client";

export default function mountCompute(app: APIServer) {
  // Generate a remote compute token.
  app.post("/", async (c) => {
    const id = crypto.randomUUID();
    const token = await generateComputeToken(c.env.AUTH_SECRET, id);
    const tokenResponse: TokenResponse = {
      id,
      token,
    };
    return c.json(tokenResponse, 201);
  });

  // Connect to a compute instance.
  // TODO: There is no authentication here at the moment.
  // There obviously needs to be.
  app.get("/connect", async (c) => {
    const id = c.req.query("id");
    if (!id || !validate(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }
    if (!c.env.compute?.handleConnect) {
      return c.json({ error: "Not implemented" }, 501);
    }
    return c.env.compute.handleConnect(id, c.req.raw);
  });

  // Serve a compute instance.
  app.get("/serve", async (c) => {
    const cookieValue = getCookie(c, SESSION_COOKIE_NAME);

    if (!cookieValue) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = await decode({
      token: cookieValue,
      secret: c.env.AUTH_SECRET,
      salt: SESSION_COOKIE_NAME,
    });
    if (!token || !token.sub) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!c.env.compute?.handleServe) {
      return c.json({ error: "Not implemented" }, 501);
    }
    return c.env.compute.handleServe(token.sub as string, c.req.raw);
  });
}

const generateComputeToken = (authSecret: string, id: string) => {
  return encode({
    // TODO: Change this to "compute-token" once we update the CLI.
    salt: "workspace",
    secret: authSecret,
    token: {
      sub: id,
    },
  });
};
