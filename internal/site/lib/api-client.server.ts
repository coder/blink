import Client from "@blink.so/api";
import { cache } from "react";
import { getSessionToken } from "@/app/(auth)/auth";

const getBaseUrl = (): string => {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3005";
};

/**
 * Creates an API client for server-side usage.
 * If authenticated, includes the session token.
 */
export const getAPIClient = cache(async (): Promise<Client> => {
  const token = await getSessionToken();
  return new Client({
    baseURL: getBaseUrl(),
    authToken: token,
  });
});

/**
 * Creates an unauthenticated API client for server-side usage.
 * Use this for public endpoints that don't require authentication.
 */
export const getPublicAPIClient = cache((): Client => {
  return new Client({
    baseURL: getBaseUrl(),
  });
});
