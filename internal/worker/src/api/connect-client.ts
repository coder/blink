import { getToken } from "next-auth/jwt";

// connect-client is an endpoint for the web UI to connect to a workspace.
export default async function fetch(req: Request, env: Cloudflare.Env) {
  const url = new URL(req.url);
  const token = await getToken({
    req,
    secret: env.AUTH_SECRET,
    secureCookie: env.NODE_ENV !== "development",
  });
  if (!token?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  // TODO: Require auth.
  const workspaceID = url.searchParams.get("workspaceID");
  if (!workspaceID) {
    return new Response("workspaceID is required", { status: 400 });
  }
  const workspace = await env.WORKSPACE.get(
    env.WORKSPACE.idFromName(workspaceID)
  );
  const headers = new Headers(req.headers);
  headers.set("x-blink-magic-connection", "client");
  return workspace.fetch("https://do", {
    headers,
    method: req.method,
    body: req.body,
  });
}
