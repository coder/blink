// Script to dump the full database schema after applying all migrations
// Used to generate the squashed 0000_initial.sql migration
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "fs/promises";
import { join } from "node:path";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface Constraint {
  table: string;
  name: string;
  def: string;
  type: string;
}

async function main() {
  console.error("Creating fresh PGLite database...");
  const client = new PGlite();
  const db = drizzle(client);

  console.error("Applying all migrations manually...");
  const migrationsFolder = join(import.meta.dir, "../migrations");

  // Read migrations journal
  const journalPath = join(migrationsFolder, "meta/_journal.json");
  const journalContent = await readFile(journalPath, "utf-8");
  const journal: Journal = JSON.parse(journalContent);

  // Apply migrations in order
  for (const entry of journal.entries) {
    const migrationPath = join(migrationsFolder, `${entry.tag}.sql`);
    console.error(`Applying ${entry.tag}...`);

    let migrationSQL = await readFile(migrationPath, "utf-8");

    // Skip extensions that PGLite doesn't support
    migrationSQL = migrationSQL.replace(
      /CREATE EXTENSION IF NOT EXISTS "vector";.*?--> statement-breakpoint\s*/g,
      ""
    );
    migrationSQL = migrationSQL.replace(
      /CREATE EXTENSION IF NOT EXISTS "uuid-ossp";.*?--> statement-breakpoint\s*/g,
      ""
    );

    // Split by statement-breakpoint and execute
    const statements = migrationSQL
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s);

    for (const statement of statements) {
      if (statement) {
        try {
          await db.execute(sql.raw(statement));
        } catch (e) {
          // Continue anyway for non-critical errors (like vector extension stuff)
        }
      }
    }
  }

  console.error("Dumping schema...");

  // Get all tables
  const tables = await client.query(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
    AND tablename != '__drizzle_migrations'
    ORDER BY tablename
  `);

  // First, output all CREATE TABLE statements
  const tableStatements: string[] = [];
  const constraintStatements: Constraint[] = [];
  const indexStatements: string[] = [];

  for (const row of tables.rows as Array<{ tablename: string }>) {
    const tableName = row.tablename;

    // Get CREATE TABLE statement - use quote_ident to properly quote table name
    const result = await client.query(
      `
      SELECT 
        'CREATE TABLE ' || quote_ident(c.relname) || ' (' ||
        string_agg(
          quote_ident(a.attname) || ' ' || 
          pg_catalog.format_type(a.atttypid, a.atttypmod) ||
          CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END ||
          CASE WHEN d.adbin IS NOT NULL THEN ' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid) ELSE '' END,
          ', ' ORDER BY a.attnum
        ) || 
        ');' as create_statement
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE c.relname = $1
        AND n.nspname = 'public'
        AND a.attnum > 0
        AND NOT a.attisdropped
      GROUP BY c.relname
    `,
      [tableName]
    );

    if (
      result.rows[0] &&
      typeof result.rows[0] === "object" &&
      "create_statement" in result.rows[0]
    ) {
      tableStatements.push(result.rows[0].create_statement as string);
    }

    // Get constraints
    const constraints = await client.query(
      `
      SELECT pg_get_constraintdef(oid) as definition, conname, contype
      FROM pg_constraint
      WHERE conrelid = $1::regclass
      ORDER BY contype, conname
    `,
      [`public.${tableName}`]
    );

    for (const constraint of constraints.rows) {
      if (
        typeof constraint === "object" &&
        constraint &&
        "conname" in constraint &&
        "definition" in constraint &&
        "contype" in constraint
      ) {
        constraintStatements.push({
          table: tableName,
          name: constraint.conname as string,
          def: constraint.definition as string,
          type: constraint.contype as string,
        });
      }
    }

    // Get indexes (excluding those created by constraints)
    const indexes = await client.query(
      `
      SELECT 
        pg_get_indexdef(indexrelid) as definition
      FROM pg_index
      JOIN pg_class ON pg_index.indexrelid = pg_class.oid
      WHERE indrelid = $1::regclass
      AND NOT indisprimary
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conindid = indexrelid
      )
      ORDER BY pg_class.relname
    `,
      [`public.${tableName}`]
    );

    for (const idx of indexes.rows) {
      if (typeof idx === "object" && idx && "definition" in idx) {
        indexStatements.push(idx.definition as string);
      }
    }
  }

  // Output tables first
  for (const stmt of tableStatements) {
    console.log(stmt);
    console.log("--> statement-breakpoint");
  }

  // Then output constraints, ordering by type: c (check), u (unique), p (primary key), f (foreign key)
  const sortOrder: Record<string, number> = { c: 1, u: 2, p: 3, f: 4 };
  constraintStatements.sort(
    (a, b) => (sortOrder[a.type] || 99) - (sortOrder[b.type] || 99)
  );

  for (const constraint of constraintStatements) {
    // Quote table name if it's a reserved keyword
    const quotedTable =
      constraint.table === "user" ? `"${constraint.table}"` : constraint.table;
    console.log(
      `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${constraint.name} ${constraint.def};`
    );
    console.log("--> statement-breakpoint");
  }

  // Then indexes
  for (const idx of indexStatements) {
    console.log(idx + ";");
    console.log("--> statement-breakpoint");
  }

  // Get all functions
  const functions = await client.query(`
    SELECT 
      p.proname as name,
      pg_get_functiondef(p.oid) as definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `);

  for (const func of functions.rows) {
    if (typeof func === "object" && func && "definition" in func) {
      console.log((func.definition as string) + ";");
      console.log("--> statement-breakpoint");
    }
  }

  // Get all triggers
  const triggers = await client.query(`
    SELECT 
      t.tgname as trigger_name,
      c.relname as table_name,
      pg_get_triggerdef(t.oid) as definition
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `);

  for (const trigger of triggers.rows) {
    if (typeof trigger === "object" && trigger && "definition" in trigger) {
      console.log((trigger.definition as string) + ";");
      console.log("--> statement-breakpoint");
    }
  }

  // Get all views
  const views = await client.query(`
    SELECT 
      viewname,
      definition
    FROM pg_views
    WHERE schemaname = 'public'
    ORDER BY viewname
  `);

  for (const view of views.rows) {
    if (
      typeof view === "object" &&
      view &&
      "viewname" in view &&
      "definition" in view
    ) {
      console.log(
        `CREATE VIEW ${view.viewname as string} AS ${view.definition as string}`
      );
      console.log("--> statement-breakpoint");
    }
  }

  await client.close();
  console.error("\nDone!");
}

main().catch(console.error);
