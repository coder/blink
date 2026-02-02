import type {
  Agent,
  ApiKey,
  OrganizationWithMembership,
} from "@blink.so/database/schema";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { decode } from "next-auth/jwt";
import { validate } from "uuid";
import { z } from "zod";
import { parseApiKey, verifyApiKeyString } from "./routes/api-keys.server";
import { SESSION_COOKIE_NAME } from "./routes/auth/auth.client";
import type { Bindings } from "./server";

/**
 * Helper to parse cookies from a Cookie header string.
 */
function parseCookies(rawCookie: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  rawCookie.split(";").forEach((cookie) => {
    const [name, value] = cookie.split("=");
    if (!name || !value) {
      return;
    }
    cookies[name.trim()] = decodeURIComponent(value.trim());
  });
  return cookies;
}

/**
 * Centralized authentication middleware generator.
 * Supports API keys, agent tokens, and session authentication.
 */
export function createAuthMiddleware(options: {
  allowAgentAuth: true;
  /**
   * Custom function to extract agent invocation tokens from requests.
   * Used by tools endpoints to support alternative token locations (e.g., URL parameters).
   */
  findAgentToken?: (req: Request) => string | undefined | null;
}): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    agent_id?: string;
    user_id?: string;
    api_key?: ApiKey;
    auth_type: "session" | "api_key" | "agent";
  };
}>;
export function createAuthMiddleware(options?: {
  allowAgentAuth?: false;
  /**
   * Custom function to extract agent invocation tokens from requests.
   * Used by tools endpoints to support alternative token locations (e.g., URL parameters).
   */
  findAgentToken?: (req: Request) => string | undefined | null;
}): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    api_key?: ApiKey;
    auth_type: "session" | "api_key";
  };
}>;
export function createAuthMiddleware(
  options: {
    allowAgentAuth?: boolean;
    findAgentToken?: (req: Request) => string | undefined | null;
  } = {}
): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: any;
}> {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Priority 1: Check for API key authentication
    if (authHeader && authHeader.startsWith("Bearer bk_")) {
      const apiKeyValue = authHeader.substring(7);
      const parsed = parseApiKey(apiKeyValue);
      if (parsed.error !== undefined) {
        throw new HTTPException(401, { message: parsed.error });
      }
      const db = await c.env.database();
      const apiKey = await db.selectApiKeyByLookup(parsed.lookup);
      if (!apiKey) {
        throw new HTTPException(401, { message: "API key not found" });
      }
      const keyValid = await verifyApiKeyString({
        rootSecret: c.env.AUTH_SECRET,
        keySecret: parsed.secret,
        hash: apiKey.key_hash,
      });
      if (!keyValid) {
        throw new HTTPException(401, {
          message: "API key failed verification",
        });
      }
      if (apiKey.revoked_at) {
        throw new HTTPException(401, { message: "API key has been revoked" });
      }
      if (
        apiKey.expires_at &&
        apiKey.expires_at.getTime() < new Date().getTime()
      ) {
        throw new HTTPException(401, { message: "API key has expired" });
      }

      const userForSuspensionCheck = await db.selectUserByID(apiKey.user_id);
      if (!userForSuspensionCheck) {
        throw new HTTPException(401, { message: "User not found" });
      }
      if (userForSuspensionCheck.suspended) {
        throw new HTTPException(403, { message: "Account suspended" });
      }
      await db.updateApiKey(apiKey.id, { last_used_at: new Date() });

      c.set("user_id", apiKey.user_id);
      c.set("api_key", apiKey);
      c.set("auth_type", "api_key");
      await next();
      return;
    }

    // Priority 2: Check for agent token (if enabled)
    if (options.allowAgentAuth) {
      let rawToken: string | undefined | null;
      if (options.findAgentToken) {
        rawToken = options.findAgentToken(c.req.raw);
      }
      if (!rawToken) {
        rawToken = readAuthTokenFromRequest(c.req.raw, SESSION_COOKIE_NAME);
      }

      if (rawToken) {
        // Try to decode as agent invocation token
        try {
          const token = await decode({
            token: rawToken,
            salt: "agent-invocation",
            secret: c.env.AUTH_SECRET,
          });
          if (token && token.agent_id) {
            c.set("agent_id", token.agent_id as string);
            c.set("auth_type", "agent");
            await next();
            return;
          }
        } catch (err) {
          // Not an agent token, continue to session auth
        }
      }
    }

    // Priority 3: Fall back to session-based authentication
    const rawToken = readAuthTokenFromRequest(c.req.raw, SESSION_COOKIE_NAME);

    if (!rawToken) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    let token;
    try {
      token = await decode({
        token: rawToken,
        secret: c.env.AUTH_SECRET,
        salt: SESSION_COOKIE_NAME,
      });
    } catch {
      // Token decoding failed - invalid token
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    if (!token || !token.sub) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    // Check if user is suspended
    const db = await c.env.database();
    const userForSuspensionCheck = await db.selectUserByID(token.sub);
    if (!userForSuspensionCheck) {
      throw new HTTPException(401, { message: "User not found" });
    }
    if (userForSuspensionCheck.suspended) {
      throw new HTTPException(403, { message: "Account suspended" });
    }

    c.set("user_id", token.sub);
    c.set("auth_type", "session");
    await next();
  };
}

/**
 * Reads authentication token from request cookies or Authorization header.
 * This helper is based on next-auth/jwt logic.
 */
function readAuthTokenFromRequest(
  req: Request,
  cookieName: string
): string | undefined {
  const headers =
    req.headers instanceof Headers ? req.headers : new Headers(req.headers);

  const rawCookie = headers.get("cookie") ?? "";
  if (rawCookie) {
    const cookies = parseCookies(rawCookie);
    if (cookies[cookieName]) {
      return cookies[cookieName];
    }
  }

  const authorizationHeader = headers.get("authorization");

  if (authorizationHeader?.split(" ")[0] === "Bearer") {
    const urlEncodedToken = authorizationHeader.split(" ")[1];
    if (!urlEncodedToken) {
      return undefined;
    }
    return decodeURIComponent(urlEncodedToken);
  }
}

export const withAuth = createAuthMiddleware();

/**
 * Middleware to ensure the user is a site admin.
 * Automatically calls withAuth first.
 */
export const withSiteAdmin: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    api_key?: ApiKey;
    auth_type: "session" | "api_key";
  };
}> = async (c, next) => {
  await withAuth(c, async () => {
    const db = await c.env.database();
    const userId = c.get("user_id");
    const user = await db.selectUserByID(userId);
    if (!user || user.site_role !== "admin") {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await next();
  });
};

export const withDevhookAuth: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id?: string;
    api_key?: ApiKey;
    auth_type?: "session" | "api_key";
  };
}> = async (c, next) => {
  if (c.env.devhook?.disableAuth) {
    await next();
    return;
  }
  return withAuth(c as Parameters<typeof withAuth>[0], next);
};

export const withOrganizationIDQueryParam: MiddlewareHandler<
  {
    Bindings: Bindings;
    Variables: {
      user_id: string;
      organization: OrganizationWithMembership;
    };
  },
  string,
  {
    in: {
      user_id: string;
    };
  }
> = async (c, next) => {
  const organizationID = c.req.query("organization_id");
  if (!organizationID) {
    return c.json(
      { message: `The "organization_id" query param is required` },
      400
    );
  }
  const org = await authorizeOrganization(c, organizationID);
  c.set("organization", org);
  await next();
};

export const withPagination: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    page?: number;
    per_page?: number;
  };
}> = async (c, next) => {
  const rawPage = c.req.query("page");
  const rawPerPage = c.req.query("per_page");
  const page = rawPage ? parseInt(rawPage) : undefined;
  if (page !== undefined && isNaN(page)) {
    return c.json({ message: `The "page" query param must be a number` }, 400);
  }
  const per_page = rawPerPage ? parseInt(rawPerPage) : undefined;
  if (per_page !== undefined && isNaN(per_page)) {
    return c.json(
      { message: `The "per_page" query param must be a number` },
      400
    );
  }
  c.set("page", page);
  c.set("per_page", per_page);
  await next();
};

export const withCursorPagination: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    cursor?: string;
    limit?: number;
  };
}> = async (c, next) => {
  const cursor = c.req.query("cursor");
  let limit: number | undefined;
  if (cursor && typeof cursor !== "string") {
    return c.json({ message: "Cursor must only be specified once" }, 400);
  }
  const rawLimit = c.req.query("limit");
  if (rawLimit) {
    if (typeof rawLimit !== "string") {
      throw new HTTPException(400, {
        message: "Limit must only be specified once",
      });
    }
    limit = parseInt(rawLimit);
    if (isNaN(limit)) {
      throw new HTTPException(400, {
        message: "Limit must be a number",
      });
    }
  }
  c.set("cursor", cursor);
  c.set("limit", limit);
  await next();
};

export const withAgentURLParam: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    agent: Agent;
    organization: OrganizationWithMembership;
  };
}> = async (c, next) => {
  const id = c.req.param("agent_id");
  if (!id) {
    return c.json({ message: "Agent ID is required" }, 400);
  }
  const parsed = await z.uuid().safeParseAsync(id);
  if (!parsed.success) {
    return c.json({ message: "Invalid agent ID" }, 400);
  }
  const db = await c.env.database();
  const agent = await db.selectAgentByID(id);
  if (!agent) {
    return c.json({ message: "Agent not found" }, 404);
  }
  const org = await authorizeOrganization(c, agent.organization_id);
  c.set("agent", agent);
  c.set("organization", org);
  await next();
};

export const withOrganizationURLParam: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    organization: OrganizationWithMembership;
  };
}> = async (c, next) => {
  const id = c.req.param("organization_id");
  if (!id) {
    return c.json({ message: "Organization ID is required" }, 400);
  }
  const org = await authorizeOrganization(c, id);
  c.set("organization", org);
  await next();
};

export const authorizeOrganization = async <
  V extends {
    user_id: string;
  },
>(
  c: Context<{
    Bindings: Bindings;
    Variables: V;
  }>,
  id: string
): Promise<OrganizationWithMembership> => {
  const db = await c.env.database();

  let organization: OrganizationWithMembership | undefined;
  if (validate(id)) {
    organization = await db.selectOrganizationForUser({
      organizationID: id,
      userID: c.get("user_id"),
    });
  } else {
    // Allow getting organizations by name for simplicity.
    organization = await db.selectOrganizationForUser({
      organizationName: id,
      userID: c.get("user_id"),
    });
  }
  if (!organization) {
    throw new HTTPException(404, {
      message: "Organization not found",
    });
  }
  return organization;
};

// Alias for consistency with organization middleware
export const withAgent = withAgentURLParam;

/**
 * Middleware to ensure the organization is not personal.
 * Must be used after withAgent or withOrganization.
 */
export const withTeamOrganization: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    organization: OrganizationWithMembership;
  };
}> = async (c, next) => {
  const organization = c.get("organization");
  if (organization.kind === "personal") {
    throw new HTTPException(403, {
      message: "This feature is not available for personal organizations",
    });
  }
  await next();
};

/**
 * Middleware to check agent permissions.
 * Must be used after withAgent.
 */
export const withAgentPermission = (
  requiredPermission: "read" | "write" | "admin"
): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: {
    user_id: string;
    agent: Agent;
    organization: OrganizationWithMembership;
    agent_permission: "read" | "write" | "admin";
  };
}> => {
  return async (c, next) => {
    const agent = c.get("agent");
    const userId = c.get("user_id");
    const org = c.get("organization");
    const db = await c.env.database();

    // Org owners and admins bypass permission checks
    if (
      org.membership &&
      (org.membership.role === "owner" || org.membership.role === "admin")
    ) {
      c.set("agent_permission", "admin");
      await next();
      return;
    }

    const permission = await db.getAgentPermissionForUser({
      agentId: agent.id,
      userId,
      orgRole: org.membership?.role,
      agentVisibility: agent.visibility,
    });

    // If permission is undefined, user doesn't have access
    if (permission === undefined) {
      throw new HTTPException(403, {
        message: "Access denied: private agent requires explicit permission",
      });
    }

    c.set("agent_permission", permission);

    if (!hasPermission(permission, requiredPermission)) {
      throw new HTTPException(403, {
        message: `This action requires ${requiredPermission} permission. You have ${permission} permission.`,
      });
    }

    await next();
  };
};

/**
 * Check if current permission level satisfies required level.
 * admin > write > read
 */
function hasPermission(
  current: "read" | "write" | "admin",
  required: "read" | "write" | "admin"
): boolean {
  const levels = { read: 1, write: 2, admin: 3 };
  return levels[current] >= levels[required];
}
