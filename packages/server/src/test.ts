import type { Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import Client from "@blink.so/api";
import type { User } from "@blink.so/database/schema";
import { createPostgresURL, createTestUser } from "@blink.so/database/test";
import { encode } from "next-auth/jwt";
import { CLI_OPTION_DEFINITIONS } from "./config";
import { startServer } from "./server";

export interface ServeOptions {
  postgresUrl?: string;
  authSecret?: string;
  port?: number;
  host?: string;
  baseUrl?: string;
  accessUrl?: string;
  wildcardAccessUrl?: string | false;
  devProxy?: string | false;
  setEnv?: boolean;
  enableSignups?: boolean;
}

const stripTrailingSlash = (value: string): string => {
  return value.replace(/\/+$/, "");
};

const getAvailablePort = async (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to determine an available port"));
        });
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
};

const waitForListening = async (server: Server): Promise<void> => {
  if (server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });
};

const isServerNotRunningError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: string }).code;
  if (code === "ERR_SERVER_NOT_RUNNING") {
    return true;
  }
  const message = (err as { message?: string }).message;
  return (
    typeof message === "string" && message.includes("Server is not running")
  );
};

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) {
    return;
  }
  if (typeof server.closeAllConnections === "function") {
    try {
      server.closeAllConnections();
    } catch (err) {
      if (!isServerNotRunningError(err)) {
        throw err;
      }
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err && !isServerNotRunningError(err)) {
        reject(err);
        return;
      }
      resolve();
    });
  });
};

const applyEnv = (values: Record<string, string | undefined>) => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

export const serve = async (options?: ServeOptions) => {
  const postgresUrl = options?.postgresUrl ?? (await createPostgresURL());
  const authSecret = options?.authSecret ?? crypto.randomUUID();
  const host = options?.host ?? "localhost";
  let port = options?.port;
  let baseUrl = options?.baseUrl;

  if (baseUrl) {
    baseUrl = stripTrailingSlash(baseUrl);
    const parsedBaseUrl = new URL(baseUrl);
    if (!port) {
      if (parsedBaseUrl.port) {
        port = Number(parsedBaseUrl.port);
      } else {
        port = await getAvailablePort();
        parsedBaseUrl.port = String(port);
        baseUrl = stripTrailingSlash(parsedBaseUrl.toString());
      }
    }
  } else {
    port = port ?? (await getAvailablePort());
    baseUrl = `http://${host}:${port}`;
  }

  if (!baseUrl) {
    throw new Error("Failed to resolve baseUrl for test server");
  }
  if (port === undefined) {
    throw new Error("Failed to resolve port for test server");
  }

  const accessUrl = stripTrailingSlash(options?.accessUrl ?? baseUrl);
  const wildcardAccessUrl =
    options?.wildcardAccessUrl === false
      ? undefined
      : (options?.wildcardAccessUrl ?? `*.${new URL(accessUrl).host}`);
  const devProxy =
    options?.devProxy === false
      ? undefined
      : (options?.devProxy ?? "localhost:3000");

  const shouldSetEnv = options?.setEnv ?? true;
  const restoreEnv = shouldSetEnv
    ? applyEnv({
        AUTH_SECRET: authSecret,
        POSTGRES_URL: postgresUrl,
        NEXT_PUBLIC_BASE_URL: baseUrl,
        BLINK_ENABLE_SIGNUPS:
          (options?.enableSignups ?? true) ? "true" : "false",
        SELF_HOSTED: "true",
      })
    : () => {};

  const server = await startServer({
    host: "0.0.0.0",
    port,
    postgresUrl,
    authSecret,
    baseUrl,
    accessUrl,
    devProxy,
    wildcardAccessUrl,
    agentImage: CLI_OPTION_DEFINITIONS.agentImage.defaultValue,
    devhookDisableAuth: false,
    enableSignups: options?.enableSignups ?? true,
  });

  await waitForListening(server);

  const createAuthToken = async (userID: string) => {
    const token = await encode({
      secret: server.bindings.AUTH_SECRET,
      salt: "blink_session_token",
      token: {
        sub: userID,
      },
    });
    return token;
  };

  return {
    url: new URL(baseUrl),
    bindings: server.bindings,
    helpers: {
      createUser: async (
        userData?: Partial<User> & {
          username?: string;
          avatar_url?: string | null;
        }
      ) => {
        const db = await server.bindings.database();
        const user = await createTestUser(db, userData);
        return {
          user,
          client: new Client({
            baseURL: baseUrl,
            authToken: await createAuthToken(user.id),
          }),
        };
      },
    },
    [Symbol.asyncDispose]: async () => {
      try {
        await closeServer(server);
      } finally {
        restoreEnv();
      }
    },
  };
};
