/**
 * Example tunnel client that proxies HTTP and WebSocket requests to localhost:8000.
 *
 * Run with: npx tsx examples/client.ts
 *
 * Make sure you have:
 * 1. The tunnel server running (npx tsx examples/server.ts)
 * 2. A local server running on port 8000 (e.g., python -m http.server 8000)
 *
 * For WebSocket testing, you can use a simple WebSocket server like:
 *   npx wscat -l 8000
 * Then connect via the tunnel URL using wscat or a browser.
 */
/** biome-ignore-all lint/suspicious/noConsole: this is an example file */

import { TunnelClient } from "../src/client";

const SERVER_URL = "http://localhost:8080";
const CLIENT_SECRET = crypto.randomUUID();
const LOCAL_SERVER_PORT = 8000;

const client = new TunnelClient({
  serverUrl: SERVER_URL,
  secret: CLIENT_SECRET,
  transformRequest: async ({ method, url, headers }) => {
    url.protocol = "http";
    url.host = `localhost:${LOCAL_SERVER_PORT}`;
    return { method, url, headers };
  },
  onConnect: ({ url, id }) => {
    console.log(`Connected to tunnel server!`);
    console.log(`Client secret: ${CLIENT_SECRET}`);
    console.log(`Public URL: ${url}`);
    console.log(`Tunnel ID: ${id}`);
    console.log(
      `\nHTTP requests to ${url}/* will be proxied to http://localhost:${LOCAL_SERVER_PORT}/*`
    );
    console.log(
      `WebSocket connections to ${url.replace("http", "ws")}/* will be proxied to ws://localhost:${LOCAL_SERVER_PORT}/*`
    );
  },
  onDisconnect: () => {
    console.log("Disconnected from tunnel server");
  },
  onError: (error) => {
    console.error("Tunnel error:", error);
  },
});

console.log(`Connecting to tunnel server at ${SERVER_URL}...`);
console.log(
  `Will proxy HTTP and WebSocket requests to localhost:${LOCAL_SERVER_PORT}`
);

const disposable = client.connect();

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nDisconnecting...");
  disposable.dispose();
  process.exit(0);
});

process.on("SIGTERM", () => {
  disposable.dispose();
  process.exit(0);
});
