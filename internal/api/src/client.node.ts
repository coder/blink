import BrowserClient, { type ClientOptions } from "./client.browser";
import { getServerHeaders } from "@blink.so/runtime/types";
import Devhook from "./routes/devhook.client";
import Tools from "./routes/tools/tools.client.node";

// Devhook is only available in the Node runtime.
// It could work in the browser, but it might not be worth the effort.
export default class Client extends BrowserClient {
  public readonly devhook = new Devhook(this);
  public readonly tools = new Tools(this);

  public constructor(options?: ClientOptions) {
    const headers = getServerHeaders();
    for (const [key, value] of Object.entries(options?.headers ?? {})) {
      headers[key.toLowerCase()] = value;
    }
    super({
      ...options,
      baseURL: options?.baseURL ?? process.env.BLINK_API_URL,
      headers,
    });
  }

  public override websocket(path: string): WebSocket {
    const url = new URL(path, this.baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const headers = new Headers(this.headers);
    if (this.authToken) {
      headers.set("Authorization", `Bearer ${this.authToken}`);
    }
    const handshakeHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      handshakeHeaders[key] = value;
    });
    // biome-ignore lint/suspicious/noExplicitAny: types are wrong
    return new WebSocket(url.toString(), {
      headers: handshakeHeaders,
    } as any);
  }
}

export * from "./client.browser";
