import { hash } from "bcrypt-ts";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { join } from "path";
import connectToPostgres from "./postgres";
import Querier from "./querier";
import type {
  Agent,
  AgentDeployment,
  Chat,
  DBMessage,
  Organization,
  User,
} from "./schema";

let runningPostgres:
  | Promise<{
      client: PgDatabase<any, any>;
      url: string;
    }>
  | undefined;
let constraintData: any;
let functionsData: any;
let triggersData: any;
let viewsData: any;

// createPostgres creates a new fully-migrated PostgreSQL instance.
// It will create a template from an existing instance if it exists.
//
// This helps improve test-times dramatically.
export const createPostgresURL = async (): Promise<string> => {
  if (!runningPostgres) {
    runningPostgres = spawnPostgres({
      storage: "memory://",
    });
  }
  const { client, url } = await runningPostgres;
  const schemaName = `db${crypto.randomUUID().replace(/-/g, "")}`;
  // PGLite does not support multiple databases, so we create a schema instead.
  await client.execute(`CREATE SCHEMA ${schemaName};
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT tablename
        FROM   pg_tables
        WHERE  schemaname = 'public'
    LOOP
        EXECUTE format(
            'CREATE TABLE ${schemaName}.%I (LIKE public.%I INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING INDEXES INCLUDING STORAGE INCLUDING COMMENTS);',
            t, t);
    END LOOP;
END$$;
  `);

  // Recreate foreign key constraints with proper schema references
  if (!constraintData) {
    constraintData = await client.execute(`
      SELECT 
        c.relname AS table_name,
        con.conname AS constraint_name,
        pg_get_constraintdef(con.oid) AS constraint_definition
      FROM   pg_constraint con
      JOIN   pg_class c ON c.oid = con.conrelid
      JOIN   pg_namespace n ON n.oid = c.relnamespace
      WHERE  con.contype = 'f'
        AND  n.nspname = 'public'
    `);
  }

  for (const constraint of constraintData) {
    // Replace unqualified table references with schema-qualified ones
    const modifiedDef = constraint.constraint_definition
      .replace(/REFERENCES "(\w+)"/g, `REFERENCES "${schemaName}"."$1"`)
      .replace(/REFERENCES (\w+)\(/g, `REFERENCES "${schemaName}"."$1"(`)
      .replace(/REFERENCES public\./g, `REFERENCES "${schemaName}".`);

    // Add the constraint to the new schema table
    await client.execute(`
      ALTER TABLE "${schemaName}"."${constraint.table_name}" 
      ADD CONSTRAINT "${constraint.constraint_name}" ${modifiedDef}
    `);
  }

  // Copy functions from public schema
  if (!functionsData) {
    functionsData = await client.execute(`
    SELECT 
      p.proname AS function_name,
      pg_get_functiondef(p.oid) AS function_definition
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.prokind = 'f'
    `);
  }

  for (const func of functionsData) {
    // Replace schema references in function definition
    const modifiedFuncDef = func.function_definition
      .replace(
        /CREATE OR REPLACE FUNCTION public\./g,
        `CREATE OR REPLACE FUNCTION "${schemaName}".`
      )
      .replace(/FROM public\./g, `FROM "${schemaName}".`)
      .replace(/FROM (\w+)/g, `FROM "${schemaName}"."$1"`)
      .replace(/INSERT INTO (\w+)/g, `INSERT INTO "${schemaName}"."$1"`)
      .replace(/UPDATE (\w+)/g, `UPDATE "${schemaName}"."$1"`)
      .replace(/DELETE FROM (\w+)/g, `DELETE FROM "${schemaName}"."$1"`);

    await client.execute(modifiedFuncDef);
  }

  // Copy triggers from public schema
  if (!triggersData) {
    triggersData = await client.execute(`
    SELECT 
      t.tgname AS trigger_name,
      c.relname AS table_name,
      pg_get_triggerdef(t.oid) AS trigger_definition
    FROM   pg_trigger t
    JOIN   pg_class c ON c.oid = t.tgrelid
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  NOT t.tgisinternal
    `);
  }

  for (const trigger of triggersData) {
    // Replace schema references in trigger definition
    const modifiedTriggerDef = trigger.trigger_definition
      .replace(/ON public\./g, `ON "${schemaName}".`)
      .replace(/ON (\w+)/g, `ON "${schemaName}"."$1"`)
      .replace(
        /EXECUTE (?:PROCEDURE|FUNCTION) public\./g,
        `EXECUTE FUNCTION "${schemaName}".`
      )
      .replace(
        /EXECUTE (?:PROCEDURE|FUNCTION) (\w+)/g,
        `EXECUTE FUNCTION "${schemaName}"."$1"`
      );

    await client.execute(modifiedTriggerDef);
  }

  // Copy views from public schema (handles inter-view dependencies)
  if (!viewsData) {
    viewsData = await client.execute(`
      SELECT 
        c.relname AS view_name,
        pg_get_viewdef(c.oid, true) AS view_definition
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'v'            -- plain views
        AND n.nspname = 'public'
        AND c.relname NOT LIKE 'pg_%'
    `);
  }

  const queue = [...viewsData];
  const seen = new Set();

  while (queue.length) {
    const v = queue.shift();

    try {
      // Use SET LOCAL so unqualified names bind to the target schema at CREATE time.
      await client.execute("BEGIN");
      await client.execute(`SET LOCAL search_path TO "${schemaName}", pg_temp`);

      // Nudge any explicit public qualifiers to the new schema.
      const def = v.view_definition
        .replace(/"public"\./g, `"${schemaName}".`)
        .replace(/\bpublic\./g, `"${schemaName}".`);

      await client.execute(
        `CREATE VIEW "${schemaName}"."${v.view_name}" AS ${def}`
      );

      await client.execute("COMMIT");
      seen.delete(v.view_name);
    } catch (err) {
      await client.execute("ROLLBACK");

      // If dependencies aren't ready yet, retry later; otherwise surface the error.
      const msg = String((err as Error)?.message ?? "");
      if (/relation .* does not exist|42P01/.test(msg)) {
        if (seen.has(v.view_name)) {
          throw new Error(
            `Could not resolve dependencies for view "${v.view_name}": ${msg}`
          );
        }
        seen.add(v.view_name);
        queue.push(v);
      } else {
        throw err;
      }
    }
  }

  // Return a connection to the new schema.
  return url + "/" + schemaName;
};

export interface PostgresOptions {
  storage?: string;
  password?: string;
  port?: number;
}

export const spawnPostgres = async (options?: PostgresOptions) => {
  return new Promise<{
    client: PgDatabase<any, any>;
    url: string;
  }>((resolve, reject) => {
    const worker = new Worker(
      new URL(join(__dirname, "./postgres-worker.ts"), import.meta.url),
      {
        type: "module",
      }
    );
    worker.postMessage(options ?? {});
    worker.onmessage = (e) => {
      connectToPostgres(e.data.url)
        .then((db) => {
          resolve({
            client: db,
            url: e.data.url,
          });
        })
        .catch(reject);
    };
    worker.onerror = (e) => {
      reject(e);
    };
  });
};

export const createTestUser = async (db: Querier, user?: Partial<User>) => {
  if (user?.password) {
    user.password = await hash(user.password, 12);
  }
  return db.insertUser({
    email: `${crypto.randomUUID()}@test.com`,
    display_name: "Test User",
    email_verified: null,
    password: user?.password ?? "",
    ...user,
  });
};

export const createTestOrganization = async (
  db: Querier,
  organization?: Partial<Organization>
) => {
  const createdBy = organization?.created_by ?? crypto.randomUUID();
  return db.insertOrganizationWithMembership({
    name: "test-organization",
    created_by: createdBy,
    ...organization,
  });
};

export const createTestChat = async (
  db: Querier,
  chat: Partial<Chat> & Pick<Chat, "agent_id">
) => {
  return db.insertChat({
    id: crypto.randomUUID(),
    created_by: chat?.created_by ?? crypto.randomUUID() ?? null,
    organization_id: crypto.randomUUID(),
    created_at: new Date(),
    title: "Test Chat",
    visibility: "public",
    agent_key: "test",
    ...chat,
  });
};

export const createTestAgent = async (db: Querier, agent?: Partial<Agent>) => {
  return db.insertAgent({
    id: crypto.randomUUID(),
    created_by: agent?.created_by ?? crypto.randomUUID(),
    organization_id: agent?.organization_id ?? crypto.randomUUID(),
    name: "test-agent",
    avatar_file_id: null,
    ...agent,
  });
};

export const createTestAgentDeployment = async (
  db: Querier,
  agentDeployment: Partial<AgentDeployment> &
    Pick<AgentDeployment, "agent_id" | "created_by">
) => {
  if (!agentDeployment.target_id) {
    // Select the default production target.
    const target = await db.selectAgentDeploymentTargetByName(
      agentDeployment.agent_id,
      "production"
    );
    if (!target) {
      throw new Error("No default production target for agent");
    }
    agentDeployment.target_id = target.id;
  }

  return db.insertAgentDeployment({
    id: crypto.randomUUID(),
    entrypoint: "test",
    target_id: "never",
    status: "success",
    created_at: new Date(),
    updated_at: new Date(),
    created_from: "cli",
    platform: "lambda",
    platform_memory_mb: 256,
    ...agentDeployment,
  });
};

export const createTestMessage = async (
  db: Querier,
  message?: Partial<DBMessage>
) => {
  return db.insertMessages({
    messages: [
      {
        id: crypto.randomUUID(),
        chat_id: crypto.randomUUID(),
        role: "user",
        parts: [],
        user_id: crypto.randomUUID(),
        ...message,
      },
    ],
  });
};
