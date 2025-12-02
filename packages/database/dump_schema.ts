import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "path";

const db = new PGlite("memory://", {
  username: "postgres",
  debug: 0,
  extensions: { vector, uuid_ossp },
});

await db.waitReady;
await db.exec("SET client_min_messages TO ERROR;");
await db.exec("SET log_min_messages TO ERROR;");

// Apply all migrations
await migrate(drizzle(db), {
  migrationsFolder: join(__dirname, "migrations"),
});

console.log("✅ Migrations applied");

// Now dump the schema
const result = await db.query(`
  SELECT string_agg(ddl || ';', E'\n--> statement-breakpoint\n' ORDER BY sort_order)
  FROM (
    -- Tables
    SELECT 1 as sort_order, 
           'CREATE TABLE ' || quote_ident(schemaname) || '.' || quote_ident(tablename) || ' (...)'  as ddl
    FROM pg_tables 
    WHERE schemaname = 'public'
    
    UNION ALL
    
    -- Functions
    SELECT 2, pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    
    UNION ALL
    
    -- Triggers  
    SELECT 3, pg_get_triggerdef(t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    
    UNION ALL
    
    -- Views
    SELECT 4, 'CREATE VIEW ' || quote_ident(schemaname) || '.' || quote_ident(viewname) || ' AS ' || definition
    FROM pg_views
    WHERE schemaname = 'public'
  ) AS all_ddl
`);

console.log(result.rows[0]);
