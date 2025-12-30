import { Emitter, type Disposable } from "@blink-sdk/events";
import type { StoryFn } from "@storybook/react";
import { useEffect } from "react";

export interface MockWebSocket {
  readonly url: string;

  onClose(listener: () => void): Disposable;
  onMessage(listener: (data: Uint8Array | string) => void): Disposable;
  send(data: Uint8Array | string): void;
  close(): void;
  open(): void;
}

const withMockWebSocket = (cb: (ws: MockWebSocket) => void) => {
  return (Story: StoryFn) => {
    const onDispose = new Emitter<void>();

    window.WebSocket = class extends EventTarget {
      public static readonly CLOSING = 2;

      private readonly onSend = new Emitter<Uint8Array | string>();
      private readonly onClose = new Emitter<void>();

      // connecting state
      public readyState = 0;

      constructor(private readonly url: string) {
        super();

        const ws: MockWebSocket = {
          url: this.url,
          onClose: (fn) => {
            return this.onClose.event(fn);
          },
          onMessage: (fn) => {
            return this.onSend.event(fn);
          },
          send: (data) => {
            this.dispatchEvent(new MessageEvent("message", { data }));
          },
          close: () => {
            this.readyState = 2;
            this.dispatchEvent(new Event("close"));
            this.readyState = 3;
          },
          open: () => {
            this.readyState = 1;
            this.dispatchEvent(new Event("open"));
          },
        };
        setTimeout(() => cb(ws), 1);

        onDispose.event(() => {
          this.onClose.dispose();
          this.onSend.dispose();
        });
      }

      public send(data: Uint8Array | string) {
        this.onSend.emit(data);
      }

      public close() {
        this.onClose.emit();
      }
    } as any;

    useEffect(() => {
      // Cleanup after the story is re-rendered.
      return () => {
        onDispose.emit();
      };
    }, []);

    // @ts-expect-error
    return <Story />;
  };
};

// Generic fetch interceptor decorator with teardown and chaining support
export function withFetch(
  respond: (
    url: URL,
    init: RequestInit | undefined,
    prev: typeof fetch
  ) => (Promise<Response> | Response) | undefined
) {
  return (Story: StoryFn) => {
    let restore: (() => void) | undefined;

    const g: any = typeof globalThis !== "undefined" ? globalThis : undefined;
    if (g && g.fetch) {
      const previous = g.fetch as typeof fetch;
      const boundPrev = previous.bind(g) as typeof fetch;

      const handler = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        try {
          const url =
            typeof input === "string" || input instanceof URL
              ? new URL(
                  input.toString(),
                  (g.location?.origin as string) || "http://localhost"
                )
              : new URL(
                  (input as Request).url,
                  (g.location?.origin as string) || "http://localhost"
                );

          const result = await respond(url, init, boundPrev);
          if (result) {
            return result;
          }
        } catch {
          // fall through
        }
        return boundPrev(input as any, init);
      }) as typeof fetch;

      // Preserve any extended properties from Bun's fetch (e.g., preconnect)
      const patched = Object.assign(handler, previous);
      g.fetch = patched;
      if (typeof window !== "undefined") {
        (window as any).fetch = patched;
      }
      restore = () => {
        g.fetch = previous;
        if (typeof window !== "undefined") {
          (window as any).fetch = previous;
        }
      };
    }

    useEffect(() => restore, []);

    // @ts-expect-error
    return <Story />;
  };
}

// Chat history-specific decorator built on withFetch
// ChatHistory type (placeholder for removed schema type)
type ChatHistory = { chats: any[]; hasMore: boolean };

type ChatHistoryPage = Pick<ChatHistory, "chats" | "hasMore">;

function withChatHistory(
  pages?: ChatHistoryPage[] | (() => ChatHistoryPage[])
) {
  return withFetch((url) => {
    if (url.pathname !== "/api/history") {
      return undefined;
    }
    const arr = typeof pages === "function" ? pages() : (pages ?? []);

    // Build cursor -> next page mapping
    const map = new Map<string, ChatHistoryPage>();
    if (arr[0]) map.set("", arr[0]!);
    for (let i = 0; i < arr.length - 1; i++) {
      const last = arr[i]!.chats.at(-1) as any;
      const lastId = last?.chat?.id as string | undefined;
      if (lastId) map.set(lastId, arr[i + 1]!);
    }

    const cursor = url.searchParams.get("ending_before") ?? "";
    const body = map.get(cursor) ?? { chats: [], hasMore: false };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}
