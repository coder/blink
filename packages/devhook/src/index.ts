/**
 * @blink-sdk/devhook
 *
 * Expose local servers via a public URL.
 *
 * ## Client Usage
 *
 * ```ts
 * import { DevhookClient } from "@blink-sdk/devhook";
 *
 * const client = new DevhookClient({
 *   serverUrl: "https://devhook.example.com",
 *   secret: "my-secret-key",
 *   onRequest: async (req) => {
 *     // Forward to local server
 *     const url = new URL(req.url);
 *     url.host = "localhost:3000";
 *     return fetch(new Request(url.toString(), req));
 *   },
 *   onConnect: ({ url }) => {
 *     console.log(`Devhook available at: ${url}`);
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
 * name = "devhook-server"
 * main = "node_modules/@blink-sdk/devhook/dist/server/cloudflare.js"
 *
 * [vars]
 * DEVHOOK_SECRET = "your-server-secret"
 * DEVHOOK_BASE_URL = "https://devhook.example.com"
 * DEVHOOK_MODE = "wildcard"  # or "subpath"
 *
 * [[durable_objects.bindings]]
 * name = "DEVHOOK_SESSION"
 * class_name = "DevhookSession"
 * ```
 *
 * ### Local Testing
 *
 * ```ts
 * import { createLocalServer } from "@blink-sdk/devhook/server/local";
 *
 * const server = createLocalServer({
 *   port: 8080,
 *   secret: "server-secret",
 *   baseUrl: "http://localhost:8080",
 *   mode: "subpath",
 * });
 * ```
 */

export { DevhookClient, type DevhookClientOptions } from "./client";
export type { Disposable } from "./emitter";
export type { ConnectionEstablished } from "./schema";
