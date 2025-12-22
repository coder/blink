/**
 * Example tunnel server for local testing.
 *
 * Run with: npx tsx examples/server.ts
 */
/** biome-ignore-all lint/suspicious/noConsole: this is an example file */

import { createLocalServer } from "../src/server/local";

const PORT = 8080;
const SERVER_SECRET = "example-server-secret";

const { close } = createLocalServer({
  port: PORT,
  secret: SERVER_SECRET,
  baseUrl: `http://localhost:${PORT}`,
  mode: "subpath",
  onReady: (port) => {
    console.log(`Tunnel server running on http://localhost:${port}`);
    console.log(`Waiting for clients to connect...`);
  },
  onClientConnect: (id) => {
    console.log(`Client connected: ${id}`);
    console.log(`Public URL: http://localhost:${PORT}/tunnel/${id}`);
  },
  onClientDisconnect: (id) => {
    console.log(`Client disconnected: ${id}`);
  },
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  close();
  process.exit(0);
});
