import { DrizzleQueryError } from "drizzle-orm/errors";
import postgres from "postgres";

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
