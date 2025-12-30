import { DurableObject } from "cloudflare:workers";

export class CommandLineAuth extends DurableObject<Cloudflare.Env> {
  constructor(state: DurableObjectState, env: Cloudflare.Env) {
    super(state, env);
  }

  async dispatch(token: string): Promise<void> {
    this.ctx.getWebSockets().forEach((ws) => {
      ws.send(token);
      ws.close();
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Not a WebSocket request", { status: 400 });
    }

    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair) as [
      WebSocket,
      WebSocket,
    ];
    this.ctx.acceptWebSocket(server);
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
