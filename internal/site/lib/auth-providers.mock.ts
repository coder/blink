import { fn } from "storybook/test";
import type { AuthProvider } from "./auth-providers";

export const defaultAuthProviders: Record<string, AuthProvider> = {
  credentials: {
    id: "credentials",
    name: "Credentials",
    type: "credentials",
  },
  github: {
    id: "github",
    name: "GitHub",
    type: "oauth",
  },
  google: {
    id: "google",
    name: "Google",
    type: "oauth",
  },
};

export const getAuthProviders = fn<() => Promise<Record<string, AuthProvider>>>(
  async () => {
    return defaultAuthProviders;
  }
);

export const isOauthEnabled = fn(async (): Promise<boolean> => {
  const providers = await getAuthProviders();
  return Object.values(providers).some((provider) => provider.type === "oauth");
});

export type { AuthProvider };
