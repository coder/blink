import { HTTPException } from "hono/http-exception";
import type { APIServer } from "../../server";
import { withToolsAuth } from "./tools.server";

/**
 * This exports the Exa API under a nested path - just proxying the original request.
 * TODO: We should associate cost with the request.
 */
export default function mountExa(app: APIServer) {
  app.all(
    "/:path{.+}",
    withToolsAuth({
      findToken: (req) => {
        return req.headers.get("x-api-key");
      },
    }),
    async (c) => {
      if (!c.env.TOOLS_EXA_API_KEY) {
        throw new HTTPException(500, {
          message: "The Exa API provider is not configured!",
        });
      }

      // Preserve original headers, just in case Exa adds some
      // experimental headers for features or something.
      const headers = new Headers(c.req.raw.headers);
      headers.set("x-api-key", c.env.TOOLS_EXA_API_KEY);

      const reqURL = new URL(c.req.raw.url);
      let url: URL;
      try {
        url = new URL(c.req.param("path"), "https://api.exa.ai");
        url.search = reqURL.search;
      } catch (err) {
        throw new HTTPException(500, {
          message: `Could not construct Exa API URL: ${err}`,
        });
      }

      // We just route this to the official Exa API directly.
      // We do no parsing of the inbound request intentionally,
      // as users can process the raw Exa response with an Exa client.
      const resp = await fetch(url, {
        method: c.req.method,
        headers,
        body: c.req.raw.body,
      });
      // TODO: This payload returns "costDollars":
      //   costDollars: {
      //     total: 0.01,
      //     search: {
      //       neural: 0.005,
      //     },
      //     contents: {
      //       text: 0.005,
      //     },
      //   },
      // We can use this to track costs back to the user or agent.
      return resp;
    }
  );
}
