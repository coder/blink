import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import xdg from "xdg-portable";
import * as logger from "../logger";
import {
  type CliOptionParser,
  ParseError,
  parseBoolean,
  parseDevProxy,
  parsePort,
  parseTrimmedString,
} from "./parsers";

type CliOptionDefinition<T = string | undefined> = {
  flags: string;
  description: string;
  env: `BLINK_${string}`;
  defaultValue?: T;
  parse?: CliOptionParser<T>;
  hidden?: boolean;
};

export const CLI_OPTION_DEFINITIONS = {
  dev: {
    flags: "-d, --dev [host]",
    description:
      "Proxy frontend requests to Next.js dev server (localhost:3000 if no host specified)",
    env: "BLINK_DEV",
    parse: parseDevProxy,
    hidden: true,
  },
  host: {
    flags: "-h, --host <host>",
    description: "Host to bind the server to",
    env: "BLINK_HOST",
    defaultValue: "0.0.0.0",
  },
  port: {
    flags: "-p, --port <port>",
    description: "Port to run the server on",
    env: "BLINK_PORT",
    defaultValue: "3005",
    parse: parsePort,
  },
  accessUrl: {
    flags: "--access-url <url>",
    description:
      "Public access URL for the server; skips try.blink.host proxy setup if provided",
    env: "BLINK_ACCESS_URL",
  },
  authSecret: {
    flags: "--auth-secret <secret>",
    description: "Secret used for authentication",
    env: "BLINK_AUTH_SECRET",
  },
  postgresUrl: {
    flags: "--postgres-url <url>",
    description:
      "PostgreSQL connection URL (format: postgresql://user:password@host:port/database)",
    env: "BLINK_POSTGRES_URL",
  },
  tunnelServerUrl: {
    flags: "--tunnel-server-url <url>",
    description: "Tunnel server URL used to create a public access URL",
    env: "BLINK_TUNNEL_SERVER_URL",
    defaultValue: "https://try.blink.host",
    hidden: true,
  },
  wildcardAccessUrl: {
    flags: "--wildcard-access-url <host>",
    description:
      "Wildcard access URL for subdomain routing, must start with '*.' (e.g. '*.blink.example.com')",
    env: "BLINK_WILDCARD_ACCESS_URL",
  },
  agentImage: {
    flags: "--agent-image <image>",
    description: "Docker image to use for running agents",
    env: "BLINK_AGENT_IMAGE",
    defaultValue: "ghcr.io/coder/blink-agent:latest",
  },
  devhookDisableAuth: {
    flags: "--devhook-disable-auth",
    description: "Disable authentication for devhook routes",
    env: "BLINK_DEVHOOK_DISABLE_AUTH",
    defaultValue: "false",
    parse: parseBoolean,
    hidden: true,
  },
  enableSignups: {
    flags: "--enable-signups",
    description: "Enable public signups",
    env: "BLINK_ENABLE_SIGNUPS",
    defaultValue: "false",
    parse: parseBoolean,
  },
} as const satisfies Record<string, CliOptionDefinition<unknown>>;

export type CliOptionKey = keyof typeof CLI_OPTION_DEFINITIONS;

export type CliOptionValue<K extends CliOptionKey> =
  (typeof CLI_OPTION_DEFINITIONS)[K] extends {
    parse: CliOptionParser<infer T>;
  }
    ? T
    : (typeof CLI_OPTION_DEFINITIONS)[K] extends { defaultValue: unknown }
      ? string
      : string | undefined;

type CliOptionKeysWithDefault = {
  [K in CliOptionKey]: (typeof CLI_OPTION_DEFINITIONS)[K] extends {
    defaultValue: unknown;
  }
    ? K
    : never;
}[CliOptionKey];

type CliOptionKeysWithoutDefault = Exclude<
  CliOptionKey,
  CliOptionKeysWithDefault
>;

export type ResolvedCliOptions = {
  [K in CliOptionKeysWithDefault]: CliOptionValue<K>;
} & {
  [K in CliOptionKeysWithoutDefault]?: CliOptionValue<K>;
};

const getCliOptionParser = <K extends CliOptionKey>(
  key: K
): CliOptionParser<CliOptionValue<K>> => {
  const spec = CLI_OPTION_DEFINITIONS[key];
  const parser =
    "parse" in spec && spec.parse ? spec.parse : parseTrimmedString;
  return parser as CliOptionParser<CliOptionValue<K>>;
};

export const parseCliOptionValue = <K extends CliOptionKey>(
  key: K,
  value: string | undefined,
  source?: "cli" | "env" | "default"
): CliOptionValue<K> => {
  const parser = getCliOptionParser(key);
  try {
    return parser(value);
  } catch (error) {
    if (error instanceof ParseError) {
      const spec = CLI_OPTION_DEFINITIONS[key];
      const sourceInfo =
        source === "env"
          ? ` (from ${spec.env})`
          : source === "cli"
            ? ` (from ${spec.flags.split(",")[0]?.trim()})`
            : "";
      throw new Error(`Invalid ${key}${sourceInfo}: ${error.message}`);
    }
    throw error;
  }
};

export const getCliEnvValue = <K extends CliOptionKey>(
  key: K
): CliOptionValue<K> | undefined => {
  const spec = CLI_OPTION_DEFINITIONS[key];
  const rawValue = process.env[spec.env];
  if (rawValue === undefined) {
    return undefined;
  }
  return parseCliOptionValue(key, rawValue, "env");
};

export function getBlinkServerConfigDir(): string {
  return join(xdg.config(), "blink-server");
}

function getAuthSecretPath(): string {
  return join(getBlinkServerConfigDir(), "auth-secret.txt");
}

export function getOrGenerateAuthSecret(): string {
  const authSecretPath = getAuthSecretPath();
  logger.warn(
    `${CLI_OPTION_DEFINITIONS.authSecret.env} not set, using auto-generated secret from ${authSecretPath}. Set the environment variable for production use.`
  );
  if (existsSync(authSecretPath)) {
    return readFileSync(authSecretPath, "utf-8").trim();
  }
  mkdirSync(getBlinkServerConfigDir(), { recursive: true });
  const secret = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32))
  ).toString("base64");
  writeFileSync(authSecretPath, secret);
  return secret;
}
