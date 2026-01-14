// This is just a client for the agent invocation API.
// It's here so it could be reused, but also because it's
// much easier to test.

import type {
  CreateChatMessage,
  SendMessagesBehavior,
} from "../../messages.client";

export interface AgentInvocationClientOptions {
  baseURL?: string;
  authToken?: string;
  deploymentToken?: string;
}

// No Zod here so the wrapper client has no dependencies.
// Faster startup time!
export interface SendMessagesRequest {
  messages: Array<CreateChatMessage>;
  behavior: SendMessagesBehavior;
}

export default class AgentInvocationClient {
  private readonly baseURL: string;
  private readonly authToken?: string;
  private readonly deploymentToken?: string;

  public constructor(options?: AgentInvocationClientOptions) {
    this.baseURL = options?.baseURL ?? "https://blink.so";
    this.authToken = options?.authToken;
    this.deploymentToken = options?.deploymentToken;
  }

  public async deleteStorage(key: string): Promise<void> {
    const resp = await this.request(
      "DELETE",
      `/api/agents/me/storage/${encodeURIComponent(key)}`
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async setStorage(
    key: string,
    value: string,
    options?: { ttl?: number }
  ): Promise<void> {
    const searchParams = new URLSearchParams();
    if (options?.ttl) {
      searchParams.set("ttl", options.ttl.toString());
    }
    const resp = await this.request(
      "PUT",
      `/api/agents/me/storage/${encodeURIComponent(key)}?${searchParams.toString()}`,
      value
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async getStorage(key: string): Promise<string | undefined> {
    const resp = await this.request(
      "GET",
      `/api/agents/me/storage/${encodeURIComponent(key)}`
    );
    if (resp.status === 404) {
      return undefined;
    }
    await this.assertResponseStatus(resp, 200);
    return await resp.text();
  }

  public async listStorage(
    prefix?: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<{
    entries: Array<{
      key: string;
      value: string;
    }>;
    cursor?: string;
  }> {
    const resp = await this.request(
      "GET",
      `/api/agents/me/storage`,
      JSON.stringify({ prefix, limit: options?.limit, cursor: options?.cursor })
    );
    await this.assertResponseStatus(resp, 200);
    return await resp.json();
  }

  public async upsertChat(key: string): Promise<{
    id: string;
    created: boolean;
    created_at: string;
  }> {
    const resp = await this.request(
      "PUT",
      `/api/agents/me/chats/${encodeURIComponent(key)}`
    );
    // We can remove this once we move off all v2 deployments.
    if (resp.status !== 200 && resp.status !== 204) {
      await this.assertResponseStatus(resp, 200);
    }
    return await resp.json();
  }

  public async sendMessages(
    key: string,
    request: SendMessagesRequest
  ): Promise<void> {
    const resp = await this.request(
      "POST",
      `/api/agents/me/chats/${encodeURIComponent(key)}/messages`,
      JSON.stringify(request)
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async getChat(id: string): Promise<
    | {
        id: string;
        createdAt: string;
      }
    | undefined
  > {
    const resp = await this.request(
      "GET",
      `/api/agents/me/chats/${encodeURIComponent(id)}`
    );
    if (resp.status === 404) {
      return undefined;
    }
    await this.assertResponseStatus(resp, 200);
    return await resp.json();
  }

  public async deleteChat(id: string): Promise<void> {
    const resp = await this.request(
      "DELETE",
      `/api/agents/me/chats/${encodeURIComponent(id)}`
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async startChat(id: string): Promise<void> {
    const resp = await this.request(
      "POST",
      `/api/agents/me/chats/${encodeURIComponent(id)}/start`
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async stopChat(id: string): Promise<void> {
    const resp = await this.request(
      "POST",
      `/api/agents/me/chats/${encodeURIComponent(id)}/stop`
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async getMessages(id: string): Promise<Array<CreateChatMessage>> {
    const resp = await this.request(
      "GET",
      `/api/agents/me/chats/${encodeURIComponent(id)}/messages`
    );
    await this.assertResponseStatus(resp, 200);
    return await resp.json();
  }

  public async deleteMessages(id: string, messageIds: string[]): Promise<void> {
    const resp = await this.request(
      "POST",
      `/api/agents/me/chats/${encodeURIComponent(id)}/messages/delete`,
      JSON.stringify({ message_ids: messageIds })
    );
    await this.assertResponseStatus(resp, 204);
  }

  public async proxyOtlpTraces(request: Request): Promise<Response> {
    if (!this.authToken && !this.deploymentToken) {
      // In our new docker-based runtime, the deployment token should always be available.
      // In our legacy lambda runtime, there are valid situations where the agent may send traces but an invocation
      // token is not available. For example, when the blink platform
      // queries `/_agent/health` and the agent sends an associated trace.
      // In these situations, we silently drop the traces and tell the agent
      // that they were all processed successfully. The response format is based on the OTEL spec:
      // https://opentelemetry.io/docs/specs/otlp/#full-success
      const contentType =
        request.headers.get("content-type")?.toLowerCase() || "";
      if (contentType.includes("application/x-protobuf")) {
        return new Response(new Uint8Array(0), {
          status: 200,
          headers: { "Content-Type": "application/x-protobuf" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Headers that should not be forwarded when proxying
    const hopByHopHeaders = new Set([
      "transfer-encoding",
      "content-length",
      "host",
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "upgrade",
    ]);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (hopByHopHeaders.has(key.toLowerCase())) {
        return;
      }
      headers[key] = value;
    });
    if (this.deploymentToken) {
      headers.Authorization = `Bearer ${this.deploymentToken}`;
    } else if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    return this.request(
      request.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      `/api/otlp/v1/traces`,
      request.body ?? undefined,
      { headers }
    );
  }

  private async assertResponseStatus(
    resp: Response,
    status: number
  ): Promise<void> {
    if (resp.status === status) {
      return;
    }
    const body = await resp.text();
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      throw new Error(body);
    } catch (err) {
      throw new Error(`Expected status ${status}, got ${resp.status}: ${body}`);
    }
  }

  private request(
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    path: string,
    body?: BodyInit,
    options?: {
      headers?: Record<string, string>;
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
    if (options?.timeout) {
      signal = AbortSignal.timeout(options.timeout);
    }
    return fetch(url.toString(), {
      method,
      headers,
      body,
      signal,
      duplex: body ? "half" : undefined,
    } as RequestInit);
  }
}
