import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import xdg from "xdg-portable";
import * as logger from "./logger";

export function getBlinkServerConfigDir(): string {
  return join(xdg.config(), "blink-server");
}

function getAuthSecretPath(): string {
  return join(getBlinkServerConfigDir(), "auth-secret.txt");
}

export function getOrGenerateAuthSecret(): string {
  const envSecret = process.env.BLINK_AUTH_SECRET || process.env.AUTH_SECRET;
  if (envSecret) {
    return envSecret;
  }
  const authSecretPath = getAuthSecretPath();
  logger.warn(
    `BLINK_AUTH_SECRET not set, using auto-generated secret from ${authSecretPath}. Set the environment variable for production use.`
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
