import type { AuthProvider } from "@blink.so/api";
import { cache } from "react";
import { getPublicAPIClient } from "./api-client.server";

export type { AuthProvider };

export const getAuthProviders = cache(
  async (): Promise<Record<string, AuthProvider>> => {
    try {
      const client = getPublicAPIClient();
      return await client.auth.getProviders();
    } catch {
      return {};
    }
  }
);

export const isOauthEnabled = cache(async (): Promise<boolean> => {
  const providers = await getAuthProviders();
  return Object.values(providers).some((provider) => provider.type === "oauth");
});
