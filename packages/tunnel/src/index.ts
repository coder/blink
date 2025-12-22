/**
 * @blink-sdk/tunnel
 *
 * Expose local servers via a public URL.
 *
 * ## Client Usage
 *
 * ```ts
 * import { TunnelClient } from "@blink-sdk/tunnel";
 *
 * const client = new TunnelClient({
 *   serverUrl: "https://tunnel.example.com",
 *   secret: "my-secret-key",
 *   onRequest: async (req) => {
 *     // Forward to local server
 *     const url = new URL(req.url);
 *     url.host = "localhost:3000";
 *     return fetch(new Request(url.toString(), req));
 *   },
 *   onConnect: ({ url }) => {
 *     console.log(`Tunnel available at: ${url}`);
 *   },
 * });
 *
 * const disposable = client.connect();
 * // Later: disposable.dispose();
 * ```
 *
 * ## Server Deployment
 *
 * The server can be deployed to Cloudflare Workers or run locally.
 * See the `server/` directory for implementation details.
 *
 * ### Cloudflare Workers
 *
 * ```toml
 * # wrangler.toml
 * name = "tunnel-server"
 * main = "node_modules/@blink-sdk/tunnel/dist/server/cloudflare.js"
 *
 * [vars]
 * TUNNEL_SECRET = "your-server-secret"
 * TUNNEL_BASE_URL = "https://tunnel.example.com"
 * TUNNEL_MODE = "wildcard"  # or "subpath"
 *
 * [[durable_objects.bindings]]
 * name = "TUNNEL_SESSION"
 * class_name = "TunnelSession"
 * ```
 *
 * ### Local Testing
 *
 * ```ts
 * import { createLocalServer } from "@blink-sdk/tunnel/server/local";
 *
 * const server = createLocalServer({
 *   port: 8080,
 *   secret: "server-secret",
 *   baseUrl: "http://localhost:8080",
 *   mode: "subpath",
 * });
 * ```
 */

export {
  TunnelClient,
  type TunnelClientOptions,
  type WebSocketRequest,
} from "./client";
export type { Disposable } from "./emitter";
export type { ConnectionEstablished } from "./schema";
