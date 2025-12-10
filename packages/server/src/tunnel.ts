import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TunnelClient } from "@blink-sdk/tunnel";
import xdg from "xdg-portable";

function getBlinkServerConfigDir(): string {
  return join(xdg.config(), "blink-server");
}

function getTunnelSecretPath(): string {
  return join(getBlinkServerConfigDir(), "tunnel-secret.txt");
}

function getOrCreateTunnelSecret(): string {
  const tunnelSecretPath = getTunnelSecretPath();
  if (existsSync(tunnelSecretPath)) {
    return readFileSync(tunnelSecretPath, "utf-8").trim();
  }
  mkdirSync(getBlinkServerConfigDir(), { recursive: true });
  const secret = crypto.getRandomValues(new Uint8Array(16)).toBase64();
  writeFileSync(tunnelSecretPath, secret);
  return secret;
}

export interface TunnelProxy {
  accessUrl: string;
  [Symbol.dispose]: () => void;
}

export async function startTunnelProxy(
  tunnelServerUrl: string,
  port: number
): Promise<TunnelProxy> {
  const tunnelSecret = getOrCreateTunnelSecret();

  return new Promise((resolve, reject) => {
    let disposable: { dispose: () => void } | undefined;
    const client = new TunnelClient({
      serverUrl: tunnelServerUrl,
      secret: tunnelSecret,
      transformRequest: async ({ method, url, headers }) => {
        url.protocol = "http";
        url.host = `localhost:${port}`;
        return { method, url, headers };
      },
      onConnect: ({ url }) => {
        resolve({
          accessUrl: url,
          [Symbol.dispose]: () => disposable?.dispose(),
        });
      },
      onError: (error) => {
        reject(error);
      },
    });
    disposable = client.connect();
  });
}
