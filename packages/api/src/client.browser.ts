import Agents from "./routes/agents/agents.client";
import Auth from "./routes/auth/auth.client";
import Chats from "./routes/chats/chats.client";
import ChatRuns from "./routes/chats/runs.client";
import Files from "./routes/files.client";
import Invites from "./routes/invites.client";
import Messages from "./routes/messages.client";
import Organizations from "./routes/organizations/organizations.client";
import Users from "./routes/users.client";

export interface ClientOptions {
  baseURL?: string;
  authToken?: string;
  fetch?: typeof globalThis.fetch;
}

export default class Client {
  public authToken?: string;

  private readonly baseURL: URL;
  private readonly fetch?: typeof globalThis.fetch;

  public readonly auth: Auth;
  public readonly chats = new Chats(this);

  /**
   * Runs are the execution history of chats.
   * Use this to
   */
  public readonly runs = new ChatRuns(this);
  public readonly agents = new Agents(this);
  public readonly files = new Files(this);
  public readonly organizations = new Organizations(this);
  public readonly invites = new Invites(this);
  public readonly users = new Users(this);
  public readonly messages = new Messages(this);

  public constructor(options?: ClientOptions) {
    this.baseURL = new URL(
      options?.baseURL ??
        (typeof globalThis.window !== "undefined"
          ? window.location.origin
          : "https://blink.so")
    );
    this.fetch = options?.fetch;
    this.authToken = options?.authToken;
    this.auth = new Auth(this, this.baseURL);
  }

  public request(
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    path: string,
    body?: BodyInit,
    options?: {
      headers?: Record<string, string>;
      abortSignal?: AbortSignal;
      timeout?: number;
    }
  ) {
    const url = new URL(path, this.baseURL);
    const headers = new Headers();
    if (this.authToken) {
      headers.set("Authorization", `Bearer ${this.authToken}`);
    }
    if (typeof body === "string") {
      // Assume JSON. The user can always override this below.
      headers.set("Content-Type", "application/json");
    }
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }
    let signal: AbortSignal | undefined;
    if (options?.abortSignal && options?.timeout) {
      throw new Error("Cannot specify both abortSignal and timeout");
    }
    if (options?.abortSignal) {
      signal = options.abortSignal;
    }
    if (options?.timeout) {
      signal = AbortSignal.timeout(options.timeout);
    }
    return (this.fetch ?? fetch)(url.toString(), {
      method,
      headers,
      body,
      signal,
    });
  }

  public websocket(path: string): WebSocket {
    const url = new URL(path, this.baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(url.toString());
  }
}

export * from "./routes/agents/agents.client";
export * from "./routes/agents/traces.client";
export * from "./routes/chats/chats.client";
export * from "./routes/invites.client";
export * from "./routes/messages.client";
export * from "./routes/organizations/organizations.client";
export * from "./routes/users.client";
