import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Client from "@blink.so/api";

function getXdgDataDir(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

function getDevhookPath(): string {
  return join(getXdgDataDir(), "blink-server", "devhook.txt");
}

function getOrCreateDevhookID(): string {
  const devhookPath = getDevhookPath();
  if (existsSync(devhookPath)) {
    return readFileSync(devhookPath, "utf-8").trim();
  }
  mkdirSync(join(getXdgDataDir(), "blink-server"), { recursive: true });
  const id = crypto.randomUUID();
  writeFileSync(devhookPath, id);
  return id;
}

export interface DevhookProxy {
  accessUrl: string;
  cleanup: () => void;
}

export async function startDevhookProxy(port: number): Promise<DevhookProxy> {
  const devhookId = getOrCreateDevhookID();
  const accessUrl = `https://${devhookId}.blink.host`;

  const client = new Client({ baseURL: "https://blink.so" });

  return new Promise((resolve, reject) => {
    const listener = client.devhook.listen({
      id: devhookId,
      onRequest: async (request) => {
        const localUrl = new URL(request.url);
        localUrl.protocol = "http:";
        localUrl.host = `localhost:${port}`;
        return fetch(new Request(localUrl.toString(), request));
      },
      onConnect: () => {
        resolve({
          accessUrl,
          cleanup: () => listener.dispose(),
        });
      },
      onError: (error) => {
        reject(error);
      },
    });
  });
}
