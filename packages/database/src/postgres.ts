import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzleNode } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// connectToPostgres connects to a PostgreSQL instance.
export const connectToPostgres = async (
  url: string
): Promise<PgDatabase<any, any>> => {
  if (url.includes("neon.tech")) {
    // Use neon-serverless with WebSocket support for transactions
    // Dynamic imports to avoid bundling into Edge Runtime if not needed
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");

    // Use native WebSocket (Node.js v21+, Edge Runtime, browsers)
    // No need for the 'ws' package anymore!
    if (typeof WebSocket !== "undefined") {
      neonConfig.webSocketConstructor = WebSocket;
    }

    const pool = new Pool({ connectionString: url });
    return drizzle(pool);
  } else {
    const parsed = new URL(url);
    const isLocalEphemeral =
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port !== "" &&
      parsed.port !== "5432";
    const conn = postgres(url, {
      // Limit pool size to 1 for local ephemeral PGlite to avoid concurrency races.
      max: isLocalEphemeral ? 1 : undefined,
      // Maximum of 30 seconds idle time.
      idle_timeout: 30,
      // Maximum of 30 minutes of connection lifetime.
      max_lifetime: 60 * 30,

      onnotice: () => {
        // noop
      },
    });
    return drizzleNode(conn);
  }
};

export default connectToPostgres;
