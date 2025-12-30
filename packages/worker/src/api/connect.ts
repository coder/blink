import { getToken } from "next-auth/jwt";

// connect is the endpoint for a workspace to connect to Blink.
export default async function fetch(req: Request, env: Cloudflare.Env) {
  const token = await getToken({
    req,
    secret: env.AUTH_SECRET,
    salt: "workspace",
    secureCookie: env.NODE_ENV !== "development",
  });
  if (!token?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  const workspace = await env.WORKSPACE.get(
    env.WORKSPACE.idFromName(token.sub)
  );
  const headers = new Headers(req.headers);
  headers.set("x-blink-magic-connection", "server");
  return workspace.fetch("https://do", {
    headers,
    method: req.method,
    body: req.body,
  });
}
