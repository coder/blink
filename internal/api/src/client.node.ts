import BrowserClient, { type ClientOptions } from "./client.browser";
import Devhook from "./routes/devhook.client";
import Tools from "./routes/tools/tools.client.node";

// Devhook is only available in the Node runtime.
// It could work in the browser, but it might not be worth the effort.
export default class Client extends BrowserClient {
  public readonly devhook = new Devhook(this);
  public readonly tools = new Tools(this);

  public constructor(options?: ClientOptions) {
    super({
      ...options,
      baseURL: options?.baseURL ?? process.env.BLINK_API_URL,
    });
  }

  public override websocket(path: string): WebSocket {
    const url = new URL(path, this.baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    // biome-ignore lint/suspicious/noExplicitAny: types are wrong
    return new WebSocket(url.toString(), { headers } as any);
  }
}

export * from "./client.browser";
