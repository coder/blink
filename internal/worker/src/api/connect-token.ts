import { encode as encodeJWT, getToken } from "next-auth/jwt";

// connect-token generates a token for a workspace to connect to Blink.
export default async function fetch(req: Request, env: Cloudflare.Env) {
  const token = await getToken({
    req,
    secret: env.AUTH_SECRET,
    secureCookie: env.NODE_ENV !== "development",
  });
  if (!token?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  const id = crypto.randomUUID();
  const workspaceToken = await encodeJWT({
    salt: "workspace",
    secret: env.AUTH_SECRET,
    token: {
      sub: id,
    },
  });
  return Response.json({
    id,
    token: workspaceToken,
  });
}
