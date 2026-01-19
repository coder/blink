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

export const getAccessUrlBase = (accessUrl: URL): URL => {
  const baseUrl = new URL(accessUrl);
  baseUrl.search = "";
  baseUrl.hash = "";
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname += "/";
  }
  return baseUrl;
};

/**
 * Construct a webhook URL for an agent.
 * Uses subdomain routing if createRequestURL is configured, otherwise uses path-based routing.
 *
 * @param env - The bindings containing createRequestURL and accessUrl
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

  // Path-based webhook mode: /api/webhook/{request_id}/{path}
  const baseUrl = getAccessUrlBase(env.accessUrl);
  return new URL(
    `api/webhook/${requestId}${normalizedPath}`,
    baseUrl
  ).toString();
};
