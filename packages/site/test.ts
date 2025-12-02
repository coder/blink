import { createPostgresURL } from "@blink.so/database/test";
import * as path from "path";

export const setupIntegrationTest = async () => {
  process.env.DATABASE_URL = await createPostgresURL();

  const { mock } = await import("bun:test");
  mock.module("next/cache", () => {
    return {
      unstable_cache: (cb: () => Promise<any>) => {
        return () => cb();
      },
      revalidatePath: () => undefined,
      revalidateTag: () => undefined,
    };
  });

  return {
    nextHeaders: await mockNextHeaders(),
  };
};

export const setupNextAuth = async () => {
  if (require.cache[require.resolve("@/app/(auth)/auth")]) {
    delete require.cache[require.resolve("@/app/(auth)/auth")];
  }
  // These are needed for next-auth to not throw errors.
  process.env = {
    ...process.env,
    TEST: "true",
    AUTH_SECRET: "test-secret",
    GITHUB_CLIENT_ID: "test-github-client-id",
    GITHUB_CLIENT_SECRET: "test-github-client-secret",
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  };
  // @ts-ignore - We add the query param to force a fresh import,
  const auth = (await import(
    "@/app/(auth)/auth"
  )) as typeof import("@/app/(auth)/auth");
  return auth;
};

export interface MockNextHeaders {
  headers: Headers;
  cookies: Map<string, string>;
}

export const mockNextHeaders = async (): Promise<MockNextHeaders> => {
  const { mock } = await import("bun:test");
  const headers = new Headers();
  const cookies = new Map<string, string>();

  const paths = [
    "next/headers",
    path.join(
      require.resolve("next-auth"),
      "..",
      "node_modules",
      "next",
      "headers.js"
    ),
  ];

  for (const path of paths) {
    mock.module(path, () => {
      return {
        headers: () => headers,
        cookies: () => ({
          get: (key: string) => {
            if (cookies.has(key)) {
              return {
                value: cookies.get(key),
              };
            }
          },
          set: (key: string, value: string) => {
            cookies.set(key, value);
            // Create the cookie header again
            const cookieHeader = Array.from(cookies.entries())
              .map(([key, value]) => `${key}=${value}`)
              .join("; ");
            headers.set("Cookie", cookieHeader);
          },
        }),
      };
    });
  }
  return {
    headers,
    cookies,
  };
};
