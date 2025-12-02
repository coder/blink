import { spawnPostgres } from "@blink.so/database/test";
import { program } from "commander";
import path from "path";

program
  .name("db")
  .description("Spawn a fully-migrated database for development")
  .option("-m, --memory", "Use memory-based database")
  .option("-p, --port <port>", "The port to bind on", "5432")
  .action(async (options) => {
    let storage = "file://" + path.join(__dirname, "..", ".dev-database");
    if (options.memory) {
      storage = "memory://";
    }
    const { url } = await spawnPostgres({
      port: Number.parseInt(options.port),
      storage,
      password: "mysecretpassword",
    });
    console.log("PostgreSQL has started", `(${storage})`);
    console.log("$ psql " + url);
    console.log("Terminate with Ctrl+C");
  });

program.parse();
