/**
 * Example devhook client that proxies requests to localhost:8000.
 *
 * Run with: npx tsx examples/client.ts
 *
 * Make sure you have:
 * 1. The devhook server running (npx tsx examples/server.ts)
 * 2. A local server running on port 8000 (e.g., python -m http.server 8000)
 */

import { DevhookClient } from "../src/client";

const SERVER_URL = "http://localhost:8080";
const CLIENT_SECRET = "example-client-secret";
const LOCAL_SERVER_PORT = 8000;

const client = new DevhookClient({
  serverUrl: SERVER_URL,
  secret: CLIENT_SECRET,
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
    console.log(`Connected to devhook server!`);
    console.log(`Public URL: ${url}`);
    console.log(`Devhook ID: ${id}`);
    console.log(
      `\nRequests to ${url}/* will be proxied to http://localhost:${LOCAL_SERVER_PORT}/*`
    );
  },
  onDisconnect: () => {
    console.log("Disconnected from devhook server");
  },
  onError: (error) => {
    console.error("Devhook error:", error);
  },
});

console.log(`Connecting to devhook server at ${SERVER_URL}...`);
console.log(`Will proxy requests to http://localhost:${LOCAL_SERVER_PORT}`);

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
