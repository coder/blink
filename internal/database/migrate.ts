import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "path";
import { Client } from "pg";

config({
  path: "../../.env.local",
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    // This is the default that we start PostgreSQL with in dev mode.
    // Run `bun db` to start it.
    process.env.POSTGRES_URL =
      "postgresql://postgres:mysecretpassword@localhost:5432/postgres";
  }

  const connection = new Client({ connectionString: process.env.POSTGRES_URL });
  await connection.connect();
  const db = drizzle(connection);

  console.log("⏳ Running migrations...");

  const start = Date.now();
  await migrate(db, { migrationsFolder: join(__dirname, "migrations") });
  const end = Date.now();

  console.log("✅ Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("❌ Migration failed");
  console.error(err);
  process.exit(1);
});
