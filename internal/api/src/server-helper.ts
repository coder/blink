import { DrizzleQueryError } from "drizzle-orm/errors";
import postgres from "postgres";
import type { Bindings } from "./server";

export const isUniqueConstraintError = (
  err: unknown,
  constraint?: string
): boolean => {
  if (!(err instanceof DrizzleQueryError)) {
    return false;
  }
  if (!(err.cause instanceof postgres.PostgresError)) {
    return false;
  }
  if (err.cause.code !== "23505") {
    return false;
  }
  if (constraint) {
    return err.cause.constraint_name === constraint;
  }
  return true;
};

let countryNames: Intl.DisplayNames;

// detectRequestLocation is a helper function that detects the location of a request.
export const detectRequestLocation = (request: Request): string | undefined => {
  if (!("cf" in request)) {
    return undefined;
  }
  const cf = request.cf as any;
  if (!countryNames) {
    countryNames = new Intl.DisplayNames("en", { type: "region" });
  }

  const city = typeof cf.city === "string" ? cf.city.trim() : "";
  const region = typeof cf.region === "string" ? cf.region.trim() : "";
  const regionCode =
    typeof cf.regionCode === "string" ? cf.regionCode.trim() : "";
  const countryRaw =
    typeof cf.country === "string" ? cf.country.trim().toUpperCase() : "";

  const parts: string[] = [];
  if (city) parts.push(city);
  if (region || regionCode) parts.push(region || regionCode);
  if (countryRaw) {
    if (!countryNames) {
      countryNames = new Intl.DisplayNames("en", { type: "region" });
    }
    const countryName = countryNames.of(countryRaw) || countryRaw;
    parts.push(countryName);
  }
  return parts.length ? parts.join(", ") : undefined;
};

/**
 * Construct a webhook URL for an agent.
 * Uses subdomain routing if matchRequestHost is configured, otherwise uses path-based routing.
 *
 * @param env - The bindings containing createRequestURL, matchRequestHost, and accessUrl
 * @param requestId - The deployment target's request ID
 * @param path - The webhook path (e.g., "github", "slack", or "/github")
 * @returns The webhook URL
 */
export const createWebhookURL = (
  env: Bindings,
  requestId: string,
  path: string
): string => {
  // Normalize path to always start with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (env.createRequestURL) {
    const baseUrl = env.createRequestURL(requestId);
    return new URL(normalizedPath, baseUrl).toString();
  }

  // Use subdomain routing if configured
  if (env.matchRequestHost) {
    // Construct subdomain URL from accessUrl: https://{request_id}.{host}/{path}
    const baseUrl = new URL(env.accessUrl);
    baseUrl.host = `${requestId}.${baseUrl.host}`;
    baseUrl.pathname = normalizedPath;
    return baseUrl.toString();
  }

  // Path-based webhook mode: /api/webhook/{request_id}/{path}
  return `${env.accessUrl.origin}/api/webhook/${requestId}${normalizedPath}`;
};
