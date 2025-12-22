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

import { TunnelClient } from "../src/client";

const SERVER_URL = "https://try.blink.host";
const CLIENT_SECRET = crypto.randomUUID();
const LOCAL_SERVER_PORT = 8000;

const client = new TunnelClient({
  serverUrl: SERVER_URL,
  secret: CLIENT_SECRET,
  // Transform WebSocket requests to point to local server
  transformWebSocketRequest: ({ url, headers }) => {
    url.host = `localhost:${LOCAL_SERVER_PORT}`;
    url.protocol = "ws:";
    return { url, headers };
  },
  onRequest: async (request) => {
    // Forward requests to the local server
    const url = new URL(request.url);
    url.host = `localhost:${LOCAL_SERVER_PORT}`;
    url.protocol = "http:";

    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      // @ts-expect-error duplex is needed for streaming bodies
      duplex: "half",
    });

    try {
      return await fetch(newRequest);
    } catch (error) {
      console.error("Error forwarding request:", error);
      return new Response(
        JSON.stringify({ error: "Failed to connect to local server" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
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
