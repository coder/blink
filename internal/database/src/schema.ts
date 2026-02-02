import type { UIMessage } from "ai";
import type { InferSelectModel, InferSelectViewModel } from "drizzle-orm";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { reserved_usernames } from "./shared";

// Custom bytea type for storing binary data
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const ChatRunStepStalledDurationSQL = sql`INTERVAL '90 seconds'`;
export type VisibilityType = "public" | "private" | "organization";

export const siteRoleEnum = pgEnum("site_role", ["member", "admin"]);
export type SiteRole = "member" | "admin";

const organizationKind = varchar("kind", {
  enum: ["organization", "personal"],
})
  .notNull()
  .default("organization");

export const organization = pgTable(
  "organization",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 40 }).notNull().unique(),
    avatar_url: varchar("avatar_url", { length: 2048 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    created_by: uuid("created_by"),

    // This is used to determine whether an organization is a user's
    // personal organization or an organization they belong to.
    //
    // Resources are all grouped by organization to simplify the
    // database schema.
    kind: organizationKind,
    // Only set when kind is "personal"
    personal_owner_user_id: uuid("personal_owner_user_id").references(
      () => user.id,
      // If the user is deleted, cascade to their personal org
      { onDelete: "cascade" }
    ),

    billing_tier: varchar("billing_tier", { enum: ["free", "pro", "team"] })
      .notNull()
      .default("free"),
    billing_interval: varchar("billing_interval", {
      enum: ["month", "year"],
    })
      .notNull()
      .default("month"),
    stripe_customer_id: text("stripe_customer_id"),
    metronome_customer_id: text("metronome_customer_id"),
    metronome_contract_id: text("metronome_contract_id"),
    stripe_subscription_id: text("stripe_subscription_id"),
    next_billing_date: timestamp("next_billing_date"),
    billing_entitled_at: timestamp("billing_entitled_at"),
  },
  (table) => [
    check(
      "name_format",
      sql`${table.name} ~* '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$'`
    ),

    check(
      "name_not_reserved",
      sql`${table.name} NOT IN (${sql.join(
        Array.from(reserved_usernames).map((name) => sql`${name}`),
        sql`, `
      )})`
    ),

    // Exactly one personal org per user
    uniqueIndex("personal_org_per_user")
      .on(table.personal_owner_user_id)
      .where(sql`${table.kind} = 'personal'`),

    check(
      "personal_owner_presence",
      sql`(${table.kind} = 'personal' AND ${table.personal_owner_user_id} IS NOT NULL)
         OR (${table.kind} = 'organization' AND ${table.personal_owner_user_id} IS NULL)`
    ),

    check(
      "personal_created_by_matches_owner",
      sql`${table.kind} != 'personal' OR ${table.created_by} = ${table.personal_owner_user_id}`
    ),
  ]
);

export const user = pgTable("user", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  display_name: text("display_name"),
  email: text("email").unique(),
  email_verified: timestamp("email_verified", { mode: "date" }),
  password: text("password"),
  site_role: siteRoleEnum().notNull().default("member"),
  suspended: boolean("suspended").notNull().default(false),
});

export type User = InferSelectModel<typeof user>;

export const user_with_personal_organization = pgView(
  "user_with_personal_organization"
).as((qb) =>
  qb
    .select({
      ...getTableColumns(user),
      organization_id: sql`${organization.id}`.as<string>("organization_id"),
      username: sql`${organization.name}`.as<string>("username"),
      avatar_url: sql`${organization.avatar_url}`.as<string | null>(
        "avatar_url"
      ),
    })
    .from(user)
    .innerJoin(organization, eq(user.id, organization.personal_owner_user_id))
);

export type UserWithPersonalOrganization = InferSelectViewModel<
  typeof user_with_personal_organization
>;

export const user_account = pgTable(
  "user_account",
  {
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").$type<"github" | "google" | "slack">().notNull(),
    provider_account_id: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({
      columns: [account.provider, account.provider_account_id],
    }),
  })
);

export type UserAccount = InferSelectModel<typeof user_account>;

export const email_verification = pgTable(
  "email_verification",
  {
    email: text("email").notNull(),
    code: text("code").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    expires_at: timestamp("expires_at").notNull(),
  },
  (table) => ({
    emailCodeIdx: uniqueIndex("idx_email_verification_email_code").on(
      table.email,
      table.code
    ),
  })
);

export type EmailVerification = InferSelectModel<typeof email_verification>;

const organizationMembershipRole = varchar("role", {
  enum: ["owner", "admin", "member", "billing_admin"],
})
  .notNull()
  .default("member");

export const organization_invite = pgTable(
  "organization_invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email"),
    role: organizationMembershipRole,
    invited_by: uuid("invited_by").notNull(),
    code: text("code").notNull().unique(),
    reusable: boolean("reusable").notNull().default(false),
    last_accepted_at: timestamp("last_accepted_at"),

    expires_at: timestamp("expires_at")
      .defaultNow()
      .$default(() => {
        const date = new Date();
        // Invites expire in 2 days.
        date.setDate(date.getDate() + 2);
        return date;
      }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => {
    return {
      invitedByMembershipFk: foreignKey({
        columns: [table.organization_id, table.invited_by],
        foreignColumns: [
          organization_membership.organization_id,
          organization_membership.user_id,
        ],
        name: "organization_invite_invited_by_membership_fk",
      }).onDelete("cascade"),
    };
  }
);

export const organization_membership = pgTable(
  "organization_membership",
  {
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: organizationMembershipRole,

    billing_emails_opt_out: boolean("billing_emails_opt_out")
      .notNull()
      .default(false),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.organization_id, table.user_id] }),
    };
  }
);

export type Organization = InferSelectModel<typeof organization>;

export type OrganizationInvite = InferSelectModel<typeof organization_invite>;

export type OrganizationMembership = InferSelectModel<
  typeof organization_membership
>;

export type OrganizationWithMembership = Organization & {
  membership?: OrganizationMembership;
};

export type ChatSource =
  | {
      type: "slack";
      thread_id: string;
      team_id: string;
      channel: string;
      channel_is_shared: boolean;
    }
  | {
      type: "web";
      onboarding?: boolean;
    };

export const chat = pgTable(
  "chat",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    created_at: timestamp("created_at").notNull(),
    // created_by can be null for chats created from Slack.
    created_by: uuid("created_by"),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    visibility: varchar("visibility", {
      enum: ["public", "private", "organization"],
    })
      .notNull()
      .default("private"),
    title: text("title"),
    metadata: json("metadata").$type<Record<string, string>>(),
    archived: boolean("archived").notNull().default(false),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, {
        onDelete: "cascade",
      }),
    agent_deployment_id: uuid("agent_deployment_id").references(
      () => agent_deployment.id,
      { onDelete: "set null" }
    ),
    agent_deployment_target_id: uuid("agent_deployment_target_id").references(
      () => agent_deployment_target.id,
      { onDelete: "set null" }
    ),
    agent_key: varchar("agent_key", { length: 128 }).notNull(),

    // last_run_number is the sequence number of the last run.
    last_run_number: integer("last_run_number").notNull().default(0),

    // Time-to-live in seconds for this chat (copied from agent at creation).
    // null means this chat never expires (kept forever).
    expire_ttl: integer("expire_ttl"),
  },
  (table) => ({
    // Index for queries filtering by organization_id and created_at
    organizationCreatedAtIdx: index("chat_organization_created_at_idx").on(
      table.organization_id,
      table.created_at
    ),
    // Composite index for chat queries by team and created_by
    organizationCreatedByIdx: index("idx_chat_organization_created_by").on(
      table.organization_id,
      table.created_by,
      table.created_at
    ),
    // Index for chat visibility filtering
    visibilityIdx: index("idx_chat_visibility")
      .on(table.organization_id, table.visibility, table.created_at)
      .where(sql`${table.visibility} IN ('public', 'private', 'organization')`),

    // Index for finding chats with expiration set (for deletion job)
    expireTtlIdx: index("idx_chat_expire_ttl")
      .on(table.created_at)
      .where(sql`${table.expire_ttl} IS NOT NULL`),

    // Index for unique chats per deployment target.
    agentDeploymentTargetIdKeyUnique: uniqueIndex(
      "idx_chat_agent_deployment_target_id_key_unique"
    ).on(table.agent_deployment_target_id, table.agent_key),
  })
);

export type Chat = InferSelectModel<typeof chat>;

export const chat_user_state = pgTable(
  "chat_user_state",
  {
    chat_id: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    last_read_at: timestamp("last_read_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chat_id, table.user_id] }),
  })
);

export type ChatUserState = InferSelectModel<typeof chat_user_state>;

export const file = pgTable("file", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  user_id: uuid("user_id"),
  organization_id: uuid("organization_id"),
  message_id: uuid("message_id"),
  name: text("name").notNull(),
  content_type: text("content_type").notNull(),
  byte_length: integer("byte_length").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),

  // pdf_page_count is only set for PDF attachments.
  // It's because some models have a hard limit on the number
  // of pages that can be processed.
  pdf_page_count: integer("pdf_page_count"),

  // content stores the file contents directly in the database as binary data.
  // This is optional and allows implementations to store files in PostgreSQL
  // instead of external storage like R2. Uses bytea for efficient binary storage.
  content: bytea("content"),
});

export type File = InferSelectModel<typeof file>;

export type PartialFile = {
  id: string;
  content_type: string;
  byte_length: number;
  file_name: string;
};

export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    created_at: timestamp("created_at").notNull(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    chat_id: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    // These are only provided for messages that are produced as part of a run.
    chat_run_id: uuid("chat_run_id"),
    chat_run_step_id: uuid("chat_run_step_id"),

    role: varchar("role").$type<UIMessage["role"]>().notNull(),
    parts: json("parts").$type<UIMessage["parts"]>().notNull(),
    metadata: json("metadata").$type<Record<string, string>>(),
    // TODO: This will be non-nullable once we add the default Blink agent.
    agent_id: uuid("agent_id"),
    // TODO: This will be non-nullable once we add the default Blink agent.
    agent_deployment_id: uuid("agent_deployment_id"),
    user_id: uuid("user_id"),
  },
  (table) => ({
    // Composite index for message stats queries
    chatRoleCreatedIdx: index("idx_message_chat_role_created")
      .on(table.chat_id, table.role)
      .where(sql`${table.role} = 'user'`),
  })
);

export type DBMessage = InferSelectModel<typeof message>;

export const organization_billing_usage_event = pgTable(
  "organization_billing_usage_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    organization_id: uuid("organization_id").notNull(),
    transaction_id: text("transaction_id").notNull(),
    event_type: text("event_type").notNull(),
    cost_usd: numeric("cost_usd", { precision: 32, scale: 18 })
      .$type<string>()
      .notNull(),
    user_id: uuid("user_id"),
    processed_at: timestamp("processed_at"),
    error_message: text("error_message"),
  },
  (table) => [
    uniqueIndex("organization_billing_usage_event_org_txn_unique").on(
      table.organization_id,
      table.transaction_id
    ),
  ]
);

export type OrganizationBillingUsageEvent = InferSelectModel<
  typeof organization_billing_usage_event
>;

export const agent = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    created_by: uuid("created_by").notNull(),
    visibility: varchar("visibility", {
      enum: ["private", "public", "organization"],
    })
      .default("organization")
      .notNull(),
    name: varchar("name", { length: 40 }).notNull(),
    description: text("description"),
    avatar_file_id: uuid("avatar_file_id"),
    active_deployment_id: uuid("active_deployment_id"),
    // Time-to-live in seconds for chats created by this agent.
    // null means chats never expire (kept forever).
    chat_expire_ttl: integer("chat_expire_ttl"),

    last_deployment_number: integer("last_deployment_number")
      .notNull()
      .default(0),
    last_run_number: integer("last_run_number").notNull().default(0),

    // Slack setup verification state (null when no verification in progress)
    slack_verification: jsonb("slack_verification").$type<{
      signingSecret: string;
      botToken: string;
      startedAt: string;
      expiresAt: string;
      lastEventAt?: string;
      dmReceivedAt?: string;
      dmChannel?: string;
      signatureFailedAt?: string;
    }>(),

    // GitHub App setup state (null when no setup in progress)
    // Status flow: pending -> app_created -> completed
    // - pending: waiting for user to create app on GitHub
    // - app_created: app created, waiting for user to install it
    // - completed: app created and installed
    // - failed: error occurred
    github_app_setup: jsonb("github_app_setup").$type<{
      sessionId: string;
      startedAt: string;
      expiresAt: string;
      status: "pending" | "app_created" | "completed" | "failed";
      error?: string;
      installationId?: string;
      appData?: {
        id: number;
        clientId: string;
        clientSecret: string;
        webhookSecret: string;
        pem: string;
        name: string;
        htmlUrl: string;
        slug: string;
      };
    }>(),

    // Onboarding wizard state
    onboarding_state: jsonb("onboarding_state").$type<{
      currentStep:
        | "welcome"
        | "llm-api-keys"
        | "github-setup"
        | "slack-setup"
        | "web-search"
        | "deploying"
        | "success";
      finished?: boolean;
      github?: {
        appName: string;
        appUrl: string;
        installUrl: string;
        appId?: number;
        clientId?: string;
        clientSecret?: string;
        webhookSecret?: string;
        privateKey?: string;
        envVars?: {
          appId: string;
          clientId: string;
          clientSecret: string;
          webhookSecret: string;
          privateKey: string;
        };
      };
      slack?: {
        botToken: string;
        signingSecret: string;
        envVars?: {
          botToken: string;
          signingSecret: string;
        };
      };
      llm?: {
        provider?: "anthropic" | "openai" | "vercel";
        apiKey?: string;
        envVar?: string;
      };
      webSearch?: {
        provider?: "exa";
        apiKey?: string;
        envVar?: string;
      };
    }>(),

    // Integrations configuration state - tracks which integrations are configured
    // This is separate from onboarding_state to persist after onboarding completes
    integrations_state: jsonb("integrations_state").$type<{
      llm?: boolean;
      github?: boolean;
      slack?: boolean;
      webSearch?: boolean;
    }>(),
  },
  (table) => [
    check(
      "name_format",
      sql`${table.name} ~* '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$'`
    ),

    uniqueIndex("agent_name_unique").on(table.organization_id, table.name),
  ]
);

export type Agent = InferSelectModel<typeof agent>;

export type AgentWithPinned = Agent & {
  pinned: boolean;
};

export type AgentWithPermission = Agent & {
  user_permission?: AgentPermissionLevel;
};

export const agent_pin = pgTable(
  "agent_pin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => ({
    agentPinUnique: uniqueIndex("agent_pin_agent_id_user_id_unique").on(
      table.agent_id,
      table.user_id
    ),
  })
);

export type AgentPin = InferSelectModel<typeof agent_pin>;

export type AgentPermissionLevel = "read" | "write" | "admin";

const agentPermissionLevel = varchar("permission", {
  enum: ["read", "write", "admin"],
}).$type<AgentPermissionLevel>();

export const agent_permission = pgTable(
  "agent_permission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    permission: agentPermissionLevel.notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    created_by: uuid("created_by")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    agentUserUnique: uniqueIndex("agent_permission_agent_id_user_id_unique").on(
      table.agent_id,
      table.user_id
    ),
    agentIdIndex: index("agent_permission_agent_id_index").on(table.agent_id),
  })
);

export type AgentPermission = InferSelectModel<typeof agent_permission>;

export type AgentEnvDeploymentTarget = "production" | "preview";

const agentEnvDeploymentTarget = text().$type<AgentEnvDeploymentTarget>();

export const agent_deployment_target = pgTable(
  "agent_deployment_target",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    request_id: uuid("request_id").notNull().defaultRandom().unique(),
    target: text("target").notNull(),
  },
  (table) => ({
    agentIdTargetUnique: uniqueIndex(
      "agent_deployment_target_agent_id_target_unique"
    ).on(table.agent_id, table.target),
  })
);

export type AgentDeploymentTarget = InferSelectModel<
  typeof agent_deployment_target
>;

export type AgentDeploymentCompatibilityVersion = "1" | "2" | "3";

export const agent_deployment = pgTable(
  "agent_deployment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    target_id: uuid("target_id")
      .notNull()
      .references(() => agent_deployment_target.id, {
        onDelete: "cascade",
      }),
    number: integer("number").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    created_by: uuid("created_by"),
    created_from: text("created_from").$type<"cli">().notNull(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    entrypoint: text("entrypoint").notNull(),
    status: varchar("status", {
      enum: ["success", "failed", "deploying", "pending"],
    })
      .default("pending")
      .notNull(),
    error_message: text("error_message"),
    compatibility_version: text("compatibility_version")
      .$type<AgentDeploymentCompatibilityVersion>()
      .notNull()
      .default("1"),
    source_files: json("source_files").$type<
      Array<{
        path: string;
        id: string;
      }>
    >(),
    output_files: json("output_files").$type<
      Array<{
        path: string;
        id: string;
      }>
    >(),
    // The user message specified to create the deployment.
    user_message: text("user_message"),
    platform: text("platform").$type<"lambda">().notNull(),
    platform_memory_mb: integer("platform_memory_mb").notNull(),
    platform_region: text("platform_region"),
    platform_metadata: json("platform_metadata").$type<{
      type: "lambda";
      arn: string;
    }>(),
    direct_access_url: text("direct_access_url"),
  },
  (table) => ({
    agentDeploymentUnique: uniqueIndex(
      "agent_deployment_agent_id_number_unique"
    ).on(table.agent_id, table.number),
  })
);

export type AgentDeployment = InferSelectModel<typeof agent_deployment>;

export const agent_storage_kv = pgTable(
  "agent_storage_kv",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    agent_deployment_target_id: uuid("agent_deployment_target_id")
      .notNull()
      .references(() => agent_deployment_target.id, {
        onDelete: "cascade",
      }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => ({
    agentIdTargetKeyUnique: uniqueIndex(
      "agent_storage_kv_agent_deployment_target_id_key_unique"
    ).on(table.agent_deployment_target_id, table.key),
  })
);

export type AgentStorageKV = InferSelectModel<typeof agent_storage_kv>;

// chat_run is a collection of steps that are occurring for a chat.
export const chat_run = pgTable(
  "chat_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull(),
    chat_id: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    // If null, the latest is always used.
    agent_deployment_id: uuid("agent_deployment_id"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    last_step_number: integer("last_step_number").notNull().default(0),
  },
  (table) => ({
    chatRunUnique: uniqueIndex("chat_run_chat_id_number_unique").on(
      table.chat_id,
      table.number
    ),
  })
);

export type ChatRun = InferSelectModel<typeof chat_run>;

export const chat_run_step = pgTable(
  "chat_run_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Number is the step number in the run. This is nice
    // for the user to see the ordering of steps.
    number: integer("number").notNull(),

    chat_id: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    chat_run_id: uuid("chat_run_id")
      .notNull()
      .references(() => chat_run.id, { onDelete: "cascade" }),
    // We don't want chats to delete if the agent is deleted.
    // So we don't use a foreign key here.
    agent_id: uuid("agent_id").notNull(),
    agent_deployment_id: uuid("agent_deployment_id").notNull(),

    started_at: timestamp("started_at").notNull().defaultNow(),
    heartbeat_at: timestamp("heartbeat_at").notNull().defaultNow(),
    completed_at: timestamp("completed_at"),
    // interrupted_at is the timestamp when the step was interrupted.
    interrupted_at: timestamp("interrupted_at"),

    // The first and last messages that were sent to this step.
    // These can be null if the step was started with no messages.
    first_message_id: uuid("first_message_id"),
    last_message_id: uuid("last_message_id"),

    error: text("error"),
    response_status: integer("response_status"),
    response_headers: json("response_headers").$type<Record<string, string>>(),
    response_headers_redacted: boolean("response_headers_redacted")
      .notNull()
      .default(false),
    response_body: text("response_body"),
    response_body_redacted: boolean("response_body_redacted")
      .notNull()
      .default(false),
    // response_message_id is the message that was created as a result
    // of this agent run.
    response_message_id: uuid("response_message_id"),
    continuation_reason: text("continuation_reason").$type<
      "tool_call" | "queued_message"
    >(),
    time_to_first_token_micros: bigint("time_to_first_token_micros", {
      mode: "number",
    }),
    tool_calls_total: integer("tool_calls_total").notNull().default(0),
    tool_calls_completed: integer("tool_calls_completed").notNull().default(0),
    tool_calls_errored: integer("tool_calls_errored").notNull().default(0),

    // This isn't used yet, but I assume it will be in the future.
    usage_cost_usd: doublePrecision("usage_cost_usd"),
    usage_model: text("usage_model"),
    usage_total_input_tokens: integer("usage_total_input_tokens"),
    usage_total_output_tokens: integer("usage_total_output_tokens"),
    usage_total_tokens: integer("usage_total_tokens"),
    usage_total_cached_input_tokens: integer("usage_total_cached_input_tokens"),
  },
  (table) => ({
    chatRunStepUnique: uniqueIndex("chat_run_step_chat_run_id_id_unique").on(
      table.chat_run_id,
      table.number
    ),

    chatRunStepSingleStreaming: uniqueIndex("chat_run_step_single_streaming")
      .on(table.chat_id)
      .where(
        sql`${table.completed_at} IS NULL AND ${table.error} IS NULL AND ${table.interrupted_at} IS NULL`
      ),

    chatRunStepAgentIndex: index("chat_run_step_agent_id_started_at_idx").on(
      table.agent_id,
      table.started_at
    ),
    chatRunStepDeploymentIndex: index(
      "chat_run_step_agent_deployment_id_started_at_idx"
    ).on(table.agent_deployment_id, table.started_at),
  })
);

export type ChatRunStep = InferSelectModel<typeof chat_run_step>;

export type ChatRunStepStatus =
  | "streaming"
  | "stalled"
  | "completed"
  | "interrupted"
  | "error";

export const chat_run_step_with_status = pgView("chat_run_step_with_status").as(
  (qb) =>
    qb
      .select({
        ...getTableColumns(chat_run_step),
        // The ordering here is very important.
        // `completed_at` is always set - even on the case of error or interruption.
        status: sql<ChatRunStepStatus>`CASE
  WHEN ${chat_run_step.error}             IS NOT NULL THEN 'error'
  WHEN ${chat_run_step.interrupted_at}    IS NOT NULL THEN 'interrupted'
  WHEN ${chat_run_step.completed_at}      IS NOT NULL THEN 'completed'
  WHEN ${chat_run_step.continuation_reason} IS NOT NULL THEN 'streaming'
  WHEN ${chat_run_step.heartbeat_at} < NOW() - INTERVAL '90 seconds' THEN 'stalled'
  ELSE 'streaming'
END`.as("status"),
      })
      .from(chat_run_step)
);

export type ChatRunStepWithStatus = InferSelectViewModel<
  typeof chat_run_step_with_status
>;

export const chat_run_with_status = pgView("chat_run_with_status").as((qb) =>
  qb
    .select({
      ...getTableColumns(chat_run),
      agent_id:
        sql<string>`COALESCE(${chat_run_step_with_status.agent_id}, ${chat_run.agent_id})`.as(
          "agent_id"
        ),
      agent_deployment_id: sql<
        string | null
      >`COALESCE(${chat_run_step_with_status.agent_deployment_id}, ${chat_run.agent_deployment_id})`.as(
        "agent_deployment_id"
      ),
      updated_at:
        sql<Date>`COALESCE(${chat_run_step_with_status.completed_at}, ${chat_run_step_with_status.interrupted_at}, ${chat_run_step_with_status.heartbeat_at}, ${chat_run_step_with_status.started_at}, ${chat_run.created_at})`.as(
          "updated_at"
        ),
      error: chat_run_step_with_status.error,
      status: chat_run_step_with_status.status,
    })
    .from(chat_run)
    .leftJoin(
      chat_run_step_with_status,
      and(
        eq(chat_run.id, chat_run_step_with_status.chat_run_id),
        eq(chat_run_step_with_status.number, chat_run.last_step_number)
      )
    )
);

export type ChatRunWithStatus = InferSelectViewModel<
  typeof chat_run_with_status
>;

// The chat status is a simplified version of the chat run status.
// The reason is because the chat run status is more detailed, and
// the user can always drill-down the run to see the more detailed status.
export type ChatStatus = "streaming" | "idle" | "error" | "interrupted";

export const chat_with_status = pgView("chat_with_status").as((qb) =>
  qb
    .select({
      ...getTableColumns(chat),
      agent_deployment_id: sql<
        string | null
      >`COALESCE(${chat_run_with_status.agent_deployment_id}, ${chat.agent_deployment_id})`.as(
        "agent_deployment_id"
      ),
      updated_at:
        sql<Date>`COALESCE(${chat_run_with_status.updated_at}, ${chat.created_at})`.as(
          "updated_at"
        ),
      error: chat_run_with_status.error,
      status: sql<ChatStatus>`CASE
        WHEN ${chat_run_with_status.status} IS NULL THEN 'idle'
        WHEN ${chat_run_with_status.status} IN ('error', 'stalled') THEN 'error'
        WHEN ${chat_run_with_status.status} = 'interrupted' THEN 'interrupted'
        WHEN ${chat_run_with_status.status} IN ('completed', 'idle') THEN 'idle'
        ELSE 'streaming'
      END`.as("status"),
      expires_at: sql<Date | null>`CASE 
        WHEN ${chat.expire_ttl} IS NULL THEN NULL
        ELSE COALESCE(${chat_run_with_status.updated_at}, ${chat.created_at}) + (${chat.expire_ttl} || ' seconds')::interval
      END`.as("expires_at"),
    })
    .from(chat)
    .leftJoin(
      chat_run_with_status,
      and(
        eq(chat.id, chat_run_with_status.chat_id),
        eq(chat_run_with_status.number, chat.last_run_number)
      )
    )
);

export type ChatWithStatus = InferSelectViewModel<typeof chat_with_status>;

export type ChatWithStatusAndAgent = ChatWithStatus & {
  agent: Agent;
};

export const agent_environment_variable = pgTable(
  "agent_environment_variable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    created_by: uuid("created_by").notNull(),
    updated_by: uuid("updated_by").notNull(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    // Legacy plaintext value - will be null for encrypted values
    value: text("value"),
    // Encrypted value fields (null for legacy plaintext values)
    encrypted_value: text("encrypted_value"),
    encrypted_dek: text("encrypted_dek"),
    encryption_iv: text("encryption_iv"),
    encryption_auth_tag: text("encryption_auth_tag"),
    secret: boolean("secret").notNull().default(false),
    target: agentEnvDeploymentTarget
      .array()
      .notNull()
      .default(["preview", "production"]),
  },
  (table) => ({
    agentIdIdx: index("agent_environment_variable_agent_id_idx").on(
      table.agent_id
    ),

    // This prevents multiple env vars from being created for the same
    // key against the same agent in different environments.
    agentKeyProdUnique: uniqueIndex("agent_env_key_prod_unique")
      .on(table.agent_id, table.key)
      .where(sql`'production' = ANY(${table.target})`),

    agentKeyPrevUnique: uniqueIndex("agent_env_key_prev_unique")
      .on(table.agent_id, table.key)
      .where(sql`'preview' = ANY(${table.target})`),
  })
);

export type AgentEnvironmentVariable = InferSelectModel<
  typeof agent_environment_variable
>;

export const agent_deployment_log = pgTable("agent_deployment_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  agent_id: uuid("agent_id")
    .notNull()
    .references(() => agent.id, { onDelete: "cascade" }),
  deployment_id: integer("deployment_id").notNull(),
  level: varchar("level", {
    enum: ["log", "info", "warning", "error"],
  }).notNull(),
  message: text("message").notNull(),
});

export type AgentDeploymentLog = InferSelectModel<typeof agent_deployment_log>;

export const api_key = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }),
    key_hash: text("key_hash").notNull(),
    // Lookup section of the key ("bk_<lookup>_<secret>")
    key_lookup: varchar("key_lookup", { length: 12 }).notNull().unique(),
    // Prefix for easy identification (e.g. "bk")
    key_prefix: varchar("key_prefix", { length: 20 }).notNull(),
    // Last 4 characters of the key for identification
    key_suffix: varchar("key_suffix", { length: 4 }).notNull(),
    scope: varchar("scope", { enum: ["full"] })
      .notNull()
      .default("full"),
    expires_at: timestamp("expires_at"),
    last_used_at: timestamp("last_used_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    revoked_at: timestamp("revoked_at"),
    revoked_by: uuid("revoked_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    userIdx: index("api_key_user_idx").on(table.user_id),
    keyLookupIdx: index("api_key_lookup_idx").on(table.key_lookup),
  })
);

export const agent_log = pgTable(
  "agent_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    level: varchar("level", { length: 8, enum: ["info", "warn", "error"] })
      .notNull()
      .default("info"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
    payload_str: text("payload_str").notNull(),
  },
  (table) => ({
    agentTimeIdx: index("agent_log_agent_time_idx").on(
      table.agent_id,
      table.timestamp.desc()
    ),
  })
);

export type AgentLog = InferSelectModel<typeof agent_log>;

export const agent_trace = pgTable(
  "agent_trace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent_id: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    start_time: timestamp("start_time").notNull(),
    end_time: timestamp("end_time").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    agentTimeIdx: index("agent_trace_agent_time_idx").on(
      table.agent_id,
      table.start_time.desc()
    ),
  })
);

export type AgentTrace = InferSelectModel<typeof agent_trace>;
export type ApiKey = InferSelectModel<typeof api_key>;
