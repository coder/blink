import open from "open";
import { WebSocket } from "ws";
import { WorkspaceConnect } from "./connect";
import { getHost, toWsUrl } from "./lib/auth";
import { openUrl } from "./lib/util";

export default async function chat() {
  const host = getHost();
  const wsHost = toWsUrl(host);
  const id = crypto.randomUUID();
  const ws = new WebSocket(`${wsHost}/legacy-auth?id=${id}`);
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      resolve();
    };
    ws.onerror = (event) => {
      reject(event);
    };
  });
  await opened;
  const tokenPromise = new Promise<string>((resolve, reject) => {
    ws.onmessage = (event) => {
      resolve(event.data.toString());
    };
  });
  const url = `${host}/legacy-auth?id=${id}&type=workspace`;
  console.log(`Opening the following URL in your browser: ${url}`);
  await openUrl(url);

  const token = await tokenPromise;

  const srv = new WorkspaceConnect({
    url: `${wsHost}/api/connect`,
    token,
  });
  srv.onConnect(() => {
    console.log("Connected to Blink");
  });
  srv.onDisconnect(() => {
    console.log("Disconnected from Blink");
  });
}
