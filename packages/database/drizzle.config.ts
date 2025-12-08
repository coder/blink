import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({
  path: "../../.env.local",
});

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ||
      "postgresql://postgres:mysecretpassword@localhost:5432/postgres",
  },
});
