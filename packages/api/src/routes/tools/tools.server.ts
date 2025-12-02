import { createAuthMiddleware } from "../../middleware";
import type { APIServer } from "../../server";
import mountCompute from "./compute.server";
import mountExa from "./exa.server";

export default function mountTools(server: APIServer) {
  mountCompute(server.basePath("/compute"));
  mountExa(server.basePath("/exa"));
}

/**
 * Authentication middleware for tools endpoints.
 * Supports API keys, agent invocation tokens, and session authentication.
 */
export const withToolsAuth = (
  options: {
    findToken?: (req: Request) => string | undefined | null;
  } = {}
) =>
  createAuthMiddleware({
    findAgentToken: options.findToken,
    allowAgentAuth: true,
  });
