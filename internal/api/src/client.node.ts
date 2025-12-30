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
}

export * from "./client.browser";
