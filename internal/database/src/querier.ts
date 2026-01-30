import {
  and,
  asc,
  countDistinct,
  desc,
  DrizzleQueryError,
  eq,
  getTableColumns,
  getViewSelectedFields,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  not,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import type {
  PgColumn,
  PgDatabase,
  PgInsertValue,
  PgSelect,
  PgTable,
} from "drizzle-orm/pg-core";
import postgres from "postgres";
import { decryptValue, encryptValue, getMasterKey } from "./encryption";
import type { FieldFilterGroup } from "./observability/filters";
import {
  getAgentLogs as getAgentLogsImpl,
  type AgentLog as ObservabilityAgentLog,
  writeAgentLog as writeAgentLogImpl,
} from "./observability/logs";
import {
  type OtelSpan,
  readTraces,
  type ReadTracesOpts,
  writeTraces,
} from "./observability/traces";
import {
  type Agent,
  agent,
  agent_deployment,
  agent_deployment_target,
  agent_environment_variable,
  agent_permission,
  agent_pin,
  agent_storage_kv,
  type AgentDeployment,
  type AgentEnvDeploymentTarget,
  type AgentEnvironmentVariable,
  type AgentDeploymentTarget,
  type AgentPermission,
  type AgentPermissionLevel,
  type AgentWithPinned,
  api_key,
  type ApiKey,
  type Chat,
  chat,
  chat_run,
  chat_run_step,
  chat_run_step_with_status,
  chat_run_with_status,
  chat_user_state,
  chat_with_status,
  type ChatRun,
  type ChatRunStep,
  ChatRunStepStalledDurationSQL,
  type ChatRunStepStatus,
  type ChatStatus,
  type ChatWithStatusAndAgent,
  type DBMessage,
  email_verification,
  type EmailVerification,
  file,
  type File,
  message,
  type Organization,
  organization,
  organization_billing_usage_event,
  organization_invite,
  organization_membership,
  type OrganizationBillingUsageEvent,
  type OrganizationInvite,
  type OrganizationMembership,
  type OrganizationWithMembership,
  type User,
  user,
  user_account,
  user_with_personal_organization,
  type UserAccount,
  type UserWithPersonalOrganization,
} from "./schema";
import { reserved_usernames } from "./shared";

export default class Querier {
  private db: PgDatabase<any, any>;
  private inTx: boolean = false;

  public constructor(private readonly conn: PgDatabase<any, any>) {
    this.db = conn;
  }

  // insertUser inserts a new user into the database.
  public async insertUser(
    newUser: Omit<
      User,
      "id" | "early_access" | "created_at" | "updated_at" | "site_role"
    > & {
      early_access?: boolean;
      username?: string;
      avatar_url?: string | null;
      site_role?: User["site_role"];
    }
  ): Promise<UserWithPersonalOrganization> {
    let createdUser: User;
    let createdOrganization: Organization;
    let attempt = 0;
    // Extract avatar_url from newUser since it doesn't belong in the user table
    const { avatar_url, ...userValues } = newUser;
    while (true) {
      let username = newUser.username;
      if (!username) {
        username = generateUsername({
          displayName: newUser.display_name ?? undefined,
          email: newUser.email ?? undefined,
          suffix: attempt === 0 ? undefined : attempt.toString(),
        });
      }

      // Check if username is reserved
      if (reserved_usernames.has(username)) {
        if (newUser.username) {
          // If user explicitly requested a reserved username, reject it
          throw new Error(
            `Username "${username}" is reserved and cannot be used.`
          );
        }
        // If auto-generated, try next attempt
        attempt++;
        if (attempt > 100) {
          throw new Error("Failed to create user due to name collision.");
        }
        continue;
      }

      try {
        [createdUser, createdOrganization] = await this.tx(async (tx) => {
          const createdUser = await tx.db
            .insert(user)
            .values(userValues)
            .returning()
            .then((res) => res[0]!);

          // Insert a personal organization for the user.
          const createdOrganization = await tx.db
            .insert(organization)
            .values({
              name: username,
              avatar_url: avatar_url ?? null,
              created_by: createdUser.id,
              kind: "personal",
              personal_owner_user_id: createdUser.id,
            })
            .returning()
            .then((res) => res[0]!);

          // Add the user as an owner to the personal organization.
          await tx.db.insert(organization_membership).values({
            organization_id: createdOrganization.id,
            user_id: createdUser.id,
            role: "owner",
          });

          return [createdUser, createdOrganization];
        });
        break;
      } catch (err) {
        if (
          !newUser.username &&
          err instanceof DrizzleQueryError &&
          err.cause instanceof postgres.PostgresError &&
          err.cause.code === "23505"
        ) {
          attempt++;
          if (attempt > 100) {
            throw new Error("Failed to create user due to name collision.");
          }
          continue;
        }
        throw err;
      }
    }

    return {
      ...createdUser,
      organization_id: createdOrganization.id,
      username: createdOrganization.name,
      avatar_url: createdOrganization.avatar_url,
    };
  }

  // selectUserByID fetches a user by their ID.
  public async selectUserByID(
    id: string
  ): Promise<UserWithPersonalOrganization | undefined> {
    return this.db
      .select()
      .from(user_with_personal_organization)
      .where(eq(user_with_personal_organization.id, id))
      .then((res) => res[0]);
  }

  // selectUserByEmail fetches a user by their email address.
  // Email is a unique key on users.
  public async selectUserByEmail(email: string): Promise<User | undefined> {
    return this.db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .then((res) => res[0]);
  }

  // deleteUserByID deletes a user by their ID. Related data is deleted via CASCADE constraints.
  public async deleteUserByID(id: string): Promise<User | undefined> {
    const [deletedUser] = await this.db
      .delete(user)
      .where(eq(user.id, id))
      .returning();

    return deletedUser;
  }

  // updateUserByID updates a user by their ID with partial data.
  public async updateUserByID(
    data: Partial<User> & Pick<User, "id">
  ): Promise<User> {
    if (!data.id) {
      throw new Error("No user id.");
    }

    const [result] = await this.db
      .update(user)
      .set(data)
      .where(eq(user.id, data.id))
      .returning();
    if (!result) {
      throw new Error("No user found.");
    }
    return result;
  }

  // upsertUserAccount upserts a user account.
  // This is used to link login accounts to users (e.g. "Sign in with Google").
  public async upsertUserAccount(data: UserAccount): Promise<void> {
    await this.db
      .insert(user_account)
      .values(data)
      .onConflictDoUpdate({
        target: [user_account.provider, user_account.provider_account_id],
        set: data,
      });
  }

  // selectUserAccountByProviderAccountID fetches a user account by their provider and account ID.
  // Returns both the account and associated user information.
  public async selectUserAccountByProviderAccountID(
    provider: UserAccount["provider"],
    accountID: string
  ): Promise<{ user_account: UserAccount; user: User } | undefined> {
    const result = await this.db
      .select({
        user_account,
        user,
      })
      .from(user_account)
      .innerJoin(user, eq(user_account.user_id, user.id))
      .where(
        and(
          eq(user_account.provider, provider),
          eq(user_account.provider_account_id, accountID)
        )
      )
      .then((res) => res[0]);
    return result;
  }

  // deleteUserAccountByProviderAccountId removes a user account by provider and account ID.
  public async deleteUserAccountByProviderAccountID(
    params: Pick<UserAccount, "provider" | "provider_account_id">
  ): Promise<void> {
    await this.db
      .delete(user_account)
      .where(
        and(
          eq(user_account.provider, params.provider),
          eq(user_account.provider_account_id, params.provider_account_id)
        )
      );
  }

  // selectUserAccountsByProviderAndUserId fetches all user accounts for a user by provider.
  public async selectUserAccountsByProviderAndUserID(
    provider: UserAccount["provider"],
    userID: string
  ): Promise<UserAccount[]> {
    return this.db
      .select()
      .from(user_account)
      .where(
        and(
          eq(user_account.provider, provider),
          eq(user_account.user_id, userID)
        )
      );
  }

  // selectOrganizationByID fetches an organization by its ID.
  public async selectOrganizationByID(
    organizationID: string
  ): Promise<Organization | undefined> {
    return this.db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationID))
      .then((res) => res[0]);
  }

  // selectOrganizationMembershipsByUserID fetches all organization memberships for a user.
  // selectTeamOrganizations fetches all team (non-personal) organizations.
  public async selectTeamOrganizations(): Promise<Organization[]> {
    return this.db
      .select()
      .from(organization)
      .where(eq(organization.kind, "organization"));
  }

  public async selectOrganizationMembershipsByUserID(userId: string): Promise<
    Array<{
      organization_membership: OrganizationMembership;
      organization: Organization;
    }>
  > {
    return this.db
      .select()
      .from(organization_membership)
      .innerJoin(
        organization,
        eq(organization_membership.organization_id, organization.id)
      )
      .where(eq(organization_membership.user_id, userId))
      .then((v) =>
        v.map((v) => ({
          organization_membership: v.organization_membership,
          organization: v.organization,
        }))
      );
  }

  // selectOrganizationMembershipByUserIDAndOrganizationID fetches a specific organization membership for a user.
  public async selectOrganizationMembershipByUserIDAndOrganizationID(
    userId: string,
    organizationId: string
  ): Promise<
    | {
        organization_membership: OrganizationMembership;
        organization: Organization;
      }
    | undefined
  > {
    return this.db
      .select()
      .from(organization_membership)
      .innerJoin(
        organization,
        eq(organization_membership.organization_id, organization.id)
      )
      .where(
        and(
          eq(organization_membership.user_id, userId),
          eq(organization_membership.organization_id, organizationId)
        )
      )
      .then((res) => res[0])
      .then((res) =>
        res
          ? {
              organization_membership: res.organization_membership,
              organization: res.organization,
            }
          : undefined
      );
  }

  // updateOrganizationByID updates organization information by organization ID.
  // updateOrganizationByID updates organization information by organization ID.
  public async updateOrganizationByID(
    organizationId: string,
    updates: {
      name?: string;
      avatar_url?: string | null;
      custom_instructions?: string | null;
      stripe_customer_id?: string | null;
      metronome_customer_id?: string | null;
      metronome_contract_id?: string | null;
      billing_entitled_at?: Date | null;
    }
  ): Promise<Organization | undefined> {
    // Check if the new name is reserved
    if (updates.name && reserved_usernames.has(updates.name)) {
      throw new Error(
        `Username "${updates.name}" is reserved and cannot be used.`
      );
    }

    return this.db
      .update(organization)
      .set(updates)
      .where(eq(organization.id, organizationId))
      .returning()
      .then((res) => res[0]);
  }

  // updateOrganizationEntitlement updates the entitlement status for an organization.
  public async updateOrganizationEntitlement(
    organizationId: string,
    isBillingEntitled: boolean
  ): Promise<Organization | undefined> {
    return this.db
      .update(organization)
      .set({ billing_entitled_at: isBillingEntitled ? new Date() : null })
      .where(eq(organization.id, organizationId))
      .returning()
      .then((res) => res[0]);
  }

  // deleteOrganizationMembershipByUserIDAndOrganizationID removes a user from an organization.
  public async deleteOrganizationMembershipByUserIDAndOrganizationID(
    userId: string,
    organizationId: string
  ): Promise<OrganizationMembership | undefined> {
    return this.db
      .delete(organization_membership)
      .where(
        and(
          eq(organization_membership.user_id, userId),
          eq(organization_membership.organization_id, organizationId)
        )
      )
      .returning()
      .then((res) => res[0]);
  }

  // updateOrganizationMemberRoleByUserIDAndOrganizationID updates an organization member's role.
  public async updateOrganizationMemberRoleByUserIDAndOrganizationID(
    organizationId: string,
    userId: string,
    newRole: "admin" | "member" | "billing_admin"
  ): Promise<OrganizationMembership | undefined> {
    return this.db
      .update(organization_membership)
      .set({
        role: newRole,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(organization_membership.organization_id, organizationId),
          eq(organization_membership.user_id, userId)
        )
      )
      .returning()
      .then((res) => res[0]);
  }

  // updateOrganizationMemberBillingEmailsOptOutByUserIDAndOrganizationID updates an organization member's billing emails opt out preference.
  public async updateOrganizationMemberBillingEmailsOptOutByUserIDAndOrganizationID(
    organizationId: string,
    userId: string,
    optOut: boolean
  ): Promise<OrganizationMembership | undefined> {
    return this.db
      .update(organization_membership)
      .set({
        billing_emails_opt_out: optOut,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(organization_membership.organization_id, organizationId),
          eq(organization_membership.user_id, userId)
        )
      )
      .returning()
      .then((res) => res[0]);
  }

  // selectOrganizationMembersWithUserInfoByOrganizationID fetches all organization members with their information.
  public async selectOrganizationMembersWithUserInfoByOrganizationID(
    organizationId: string
  ): Promise<
    Array<{
      user: {
        id: string;
        name: string | null;
        email: string | null;
        image: string | null;
      };
      organization_membership: {
        role: "owner" | "admin" | "member" | "billing_admin";
        created_at: Date;
      };
    }>
  > {
    return this.db
      .select({
        user: {
          id: user_with_personal_organization.id,
          name: user_with_personal_organization.display_name,
          email: user_with_personal_organization.email,
          image: user_with_personal_organization.avatar_url,
        },
        organization_membership: {
          role: organization_membership.role,
          created_at: organization_membership.created_at,
        },
      })
      .from(organization_membership)
      .innerJoin(
        user_with_personal_organization,
        eq(organization_membership.user_id, user_with_personal_organization.id)
      )
      .where(eq(organization_membership.organization_id, organizationId))
      .orderBy(organization_membership.created_at);
  }

  // insertOrganizationInvite inserts a new organization invitation.
  public async insertOrganizationInvite(
    newInvite: Insertable<typeof organization_invite, "code">
  ): Promise<OrganizationInvite> {
    // If email is provided, check for existing pending invites
    if (newInvite.email) {
      const existingInvite = await this.db
        .select()
        .from(organization_invite)
        .where(
          and(
            eq(organization_invite.organization_id, newInvite.organization_id),
            eq(organization_invite.email, newInvite.email),
            // Check that invite hasn't expired (handle null expires_at)
            sql`(${organization_invite.expires_at} IS NULL OR ${organization_invite.expires_at} > NOW())`,
            // For single-use invites, check they haven't been used
            sql`(${organization_invite.reusable} = true OR ${organization_invite.last_accepted_at} IS NULL)`
          )
        )
        .then((res) => res[0]);

      if (existingInvite) {
        throw new Error(
          `An active invite already exists for ${newInvite.email}`
        );
      }
    }

    const createdInvite = await this.db
      .insert(organization_invite)
      .values({
        ...newInvite,
        code: crypto.randomUUID(),
      })
      .returning()
      .then((res) => res[0]!);

    return createdInvite;
  }

  // selectOrganizationInviteWithOrganizationByToken fetches an organization invite by its token with organization info.
  public async selectOrganizationInviteWithOrganizationByToken(
    code: string
  ): Promise<
    | {
        organization_invite: OrganizationInvite;
        organization: Organization;
      }
    | undefined
  > {
    return this.db
      .select()
      .from(organization_invite)
      .innerJoin(
        organization,
        eq(organization_invite.organization_id, organization.id)
      )
      .where(eq(organization_invite.code, code))
      .then((res) =>
        res[0]
          ? {
              organization_invite: res[0].organization_invite,
              organization: res[0].organization,
            }
          : undefined
      );
  }

  // selectOrganizationInvitesByOrganizationID fetches all pending invites for an organization.
  public async selectOrganizationInvitesByOrganizationID(
    organizationId: string
  ): Promise<OrganizationInvite[]> {
    return this.db
      .select()
      .from(organization_invite)
      .where(eq(organization_invite.organization_id, organizationId))
      .orderBy(desc(organization_invite.created_at));
  }

  // selectAllReusableOrganizationInvitesByOrganizationID fetches all reusable invites for an organization.
  public async selectAllReusableOrganizationInvitesByOrganizationID(
    organizationId: string
  ): Promise<OrganizationInvite[]> {
    return this.db
      .select()
      .from(organization_invite)
      .where(
        and(
          eq(organization_invite.organization_id, organizationId),
          eq(organization_invite.reusable, true)
        )
      )
      .orderBy(desc(organization_invite.created_at));
  }

  // deleteReusableOrganizationInvitesByOrganizationID removes all reusable invites for an organization.
  public async deleteReusableOrganizationInvitesByOrganizationID(
    organizationId: string
  ): Promise<void> {
    await this.db
      .delete(organization_invite)
      .where(
        and(
          eq(organization_invite.organization_id, organizationId),
          eq(organization_invite.reusable, true)
        )
      );
  }

  // acceptOrganizationInviteByIDAndUserID processes an organization invite acceptance and adds the user to the organization.
  public async acceptOrganizationInviteByIDAndUserID(
    inviteId: string,
    userId: string
  ): Promise<OrganizationMembership> {
    const invite = await this.db
      .select()
      .from(organization_invite)
      .where(eq(organization_invite.id, inviteId))
      .then((res) => res[0]);

    if (!invite) {
      throw new Error("Invite not found");
    }

    // Check if invite is expired (handle null expires_at)
    if (invite.expires_at && new Date() > invite.expires_at) {
      throw new Error("Invite has expired");
    }

    // Check if invite is single-use and already used
    if (!invite.reusable && invite.last_accepted_at) {
      throw new Error("Invite has already been used");
    }

    // Check if user is already a member of the organization
    const existingMembership = await this.db
      .select()
      .from(organization_membership)
      .where(
        and(
          eq(organization_membership.organization_id, invite.organization_id),
          eq(organization_membership.user_id, userId)
        )
      )
      .then((res) => res[0]);

    if (existingMembership) {
      throw new Error("You are already a member of this organization");
    }

    // Add user to organization
    const [membership] = await this.db
      .insert(organization_membership)
      .values({
        organization_id: invite.organization_id,
        user_id: userId,
        role: invite.role,
      })
      .returning();

    // Update invite with last_accepted_at
    await this.db
      .update(organization_invite)
      .set({ last_accepted_at: new Date() })
      .where(eq(organization_invite.id, invite.id));

    return membership!;
  }

  // updateOrganizationInviteLastAcceptedAtByID marks an organization invite as accepted now.
  public async updateOrganizationInviteLastAcceptedAtByID(
    inviteId: string
  ): Promise<void> {
    await this.db
      .update(organization_invite)
      .set({ last_accepted_at: new Date() })
      .where(eq(organization_invite.id, inviteId));
  }

  // deleteOrganizationInviteByID removes an organization invite.
  public async deleteOrganizationInviteByID(
    inviteId: string
  ): Promise<OrganizationInvite | undefined> {
    return this.db
      .delete(organization_invite)
      .where(eq(organization_invite.id, inviteId))
      .returning()
      .then((res) => res[0]);
  }

  // insertChat inserts a new chat into the database.
  public async insertChat(
    // The agent_key is generated by a trigger.
    params: Insertable<typeof chat, "created_at" | "agent_key">
  ): Promise<Chat> {
    return this.db
      .insert(chat)
      .values({
        ...params,
        created_at: params.created_at ?? new Date(),
      } as Insertable<typeof chat>)
      .returning()
      .then((r) => r[0]!);
  }

  // updateChatByID updates chat properties like title, model, and tools by chat ID.
  public async updateChatByID(params: {
    id: string;
    title?: string;
  }): Promise<Chat[]> {
    // Only include fields that are not undefined
    const updates: any = {};
    if (params.title !== undefined) updates.title = params.title;

    return this.db
      .update(chat)
      .set(updates)
      .where(eq(chat.id, params.id))
      .returning();
  }

  // selectChatByID fetches a chat by its ID.
  public async selectChatByID(params: {
    id: string;
  }): Promise<ChatWithStatusAndAgent | undefined> {
    const { updated_at, ...rest } = getViewSelectedFields(chat_with_status);
    const [selectedChat] = await this.db
      .select({
        ...rest,
        chat_updated_at: sql<Date>`"chat_with_status"."updated_at"`.as(
          "chat_updated_at"
        ),
        agent: getTableColumns(agent),
      })
      .from(chat_with_status)
      .innerJoin(agent, eq(chat_with_status.agent_id, agent.id))
      .where(eq(chat_with_status.id, params.id));
    return selectedChat
      ? {
          ...selectedChat,
          agent: selectedChat.agent,
          updated_at: parseDbTimestamp(selectedChat.chat_updated_at),
        }
      : undefined;
  }

  // deleteChatByID deletes a chat and all associated data by chat ID.
  // Related data is automatically deleted via CASCADE DELETE constraints.
  public async deleteChatByID(id: string): Promise<void> {
    await this.db.delete(chat).where(eq(chat.id, id));
  }

  // updateChatVisibilityByID updates the visibility setting of a chat by chat ID.
  public async updateChatVisibilityByID(params: {
    chatId: string;
    visibility: "private" | "public" | "organization";
  }): Promise<void> {
    await this.db
      .update(chat)
      .set({ visibility: params.visibility })
      .where(eq(chat.id, params.chatId));
  }

  // upsertChatUserState updates or creates chat user state for read tracking.
  public async upsertChatUserState(
    chatId: string,
    userId: string,
    updates: {
      last_read_at?: Date;
    }
  ): Promise<void> {
    await this.db
      .insert(chat_user_state)
      .values({ chat_id: chatId, user_id: userId, ...updates })
      .onConflictDoUpdate({
        target: [chat_user_state.chat_id, chat_user_state.user_id],
        set: updates,
      });
  }

  // insertMessages inserts multiple messages into the database.
  public async insertMessages({
    messages,
  }: {
    messages: Insertable<typeof message, "created_at">[];
  }): Promise<Array<DBMessage>> {
    return this.db
      .insert(message)
      .values(
        messages.map((message) => ({
          ...message,
          created_at: message.created_at ?? new Date(),
        }))
      )
      .returning();
  }

  // selectMessageByID fetches a single message by its ID.
  public async selectMessageByID(params: {
    id: string;
  }): Promise<DBMessage | undefined> {
    return this.db
      .select()
      .from(message)
      .where(eq(message.id, params.id))
      .then((res) => res[0]);
  }

  public async selectFilesByIDs(ids: string[]): Promise<File[]> {
    return this.db.select().from(file).where(inArray(file.id, ids));
  }

  public async selectFileByID(id: string): Promise<File | undefined> {
    return this.db
      .select()
      .from(file)
      .where(eq(file.id, id))
      .then((res) => res[0]);
  }
  public async insertFile(
    toCreate: Omit<File, "created_at" | "updated_at">
  ): Promise<File> {
    return this.db
      .insert(file)
      .values(toCreate)
      .returning()
      .then((res) => res[0]!);
  }

  public async insertEmailVerification({
    email,
    code,
    expiresAt,
  }: {
    email: string;
    code: string;
    expiresAt: Date;
  }): Promise<EmailVerification> {
    return this.db
      .insert(email_verification)
      .values({
        email,
        code,
        expires_at: expiresAt,
      })
      .returning()
      .then((res) => res[0]!);
  }

  public async selectAndDeleteEmailVerificationByCode({
    email,
    code,
  }: {
    email: string;
    code: string;
  }): Promise<EmailVerification | undefined> {
    return this.db
      .delete(email_verification)
      .where(
        and(
          eq(email_verification.email, email),
          eq(email_verification.code, code)
        )
      )
      .returning()
      .then((res) => res[0]);
  }

  public async selectApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    return this.db
      .select()
      .from(api_key)
      .where(and(eq(api_key.user_id, userId), isNull(api_key.revoked_at)))
      .orderBy(desc(api_key.created_at));
  }

  public async selectApiKeyByID(id: string): Promise<ApiKey | null> {
    return this.db
      .select()
      .from(api_key)
      .where(eq(api_key.id, id))
      .limit(1)
      .then((res) => res[0] || null);
  }

  public async selectApiKeyByLookup(keyLookup: string): Promise<ApiKey | null> {
    const result = await this.db
      .select()
      .from(api_key)
      .where(and(eq(api_key.key_lookup, keyLookup), isNull(api_key.revoked_at)))
      .limit(1);
    return result[0] || null;
  }

  public async insertApiKey(
    data: Omit<
      ApiKey,
      | "id"
      | "created_at"
      | "updated_at"
      | "last_used_at"
      | "revoked_at"
      | "revoked_by"
    >
  ): Promise<ApiKey> {
    const result = await this.db.insert(api_key).values(data).returning();
    return result[0]!;
  }

  public async updateApiKey(
    id: string,
    data: Partial<Pick<ApiKey, "last_used_at" | "revoked_at" | "revoked_by">>
  ): Promise<ApiKey | null> {
    const result = await this.db
      .update(api_key)
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where(eq(api_key.id, id))
      .returning();
    return result[0] || null;
  }

  public async selectOrganizationByStripeCustomerID(
    stripeCustomerId: string
  ): Promise<Organization | undefined> {
    const rows = await this.db
      .select()
      .from(organization)
      .where(eq(organization.stripe_customer_id, stripeCustomerId));

    return rows?.[0] as Organization | undefined;
  }

  public async selectOrganizationByMetronomeCustomerID(
    metronomeCustomerId: string
  ): Promise<Organization | undefined> {
    const rows = await this.db
      .select()
      .from(organization)
      .where(eq(organization.metronome_customer_id, metronomeCustomerId));

    return rows?.[0] as Organization | undefined;
  }

  public async selectAdminBillingEmailRecipientsByOrganizationID(
    organizationId: string
  ): Promise<Array<{ id: string; email: string }>> {
    const results = await this.db
      .select({
        id: user.id,
        email: user.email,
      })
      .from(organization_membership)
      .innerJoin(user, eq(organization_membership.user_id, user.id))
      .where(
        and(
          eq(organization_membership.organization_id, organizationId),
          inArray(organization_membership.role, [
            "owner",
            "admin",
            "billing_admin",
          ]),
          eq(organization_membership.billing_emails_opt_out, false),
          not(isNull(user.email))
        )
      );

    return results
      .filter((row) => row.email !== null)
      .map((row) => ({ id: row.id, email: row.email as string }));
  }

  public async selectOrganizationsForUser({
    userID,
  }: {
    userID: string;
  }): Promise<OrganizationWithMembership[]> {
    const rows = await this.db
      .select()
      .from(organization)
      .innerJoin(
        organization_membership,
        eq(organization.id, organization_membership.organization_id)
      )
      .where(eq(organization_membership.user_id, userID));

    return rows.map((row) => ({
      ...row.organization,
      membership: row.organization_membership,
    }));
  }

  public async selectOrganizationForUser(
    params:
      | {
          organizationID: string;
          userID: string;
        }
      | {
          organizationName: string;
          userID: string;
        }
  ): Promise<OrganizationWithMembership | undefined> {
    let where: SQL | undefined;
    if ("organizationID" in params) {
      where = and(
        eq(organization_membership.user_id, params.userID),
        eq(organization.id, params.organizationID)
      );
    } else {
      where = and(
        eq(organization_membership.user_id, params.userID),
        ilike(organization.name, params.organizationName)
      );
    }

    const [row] = await this.db
      .select()
      .from(organization)
      .leftJoin(
        organization_membership,
        eq(organization.id, organization_membership.organization_id)
      )
      .where(where);
    if (!row) {
      return undefined;
    }
    return {
      ...row.organization,
      membership: row.organization_membership ?? undefined,
    };
  }

  public async selectAgentByNameForUser(params: {
    organizationName: string;
    agentName: string;
    userID?: string;
  }): Promise<AgentWithPinned | undefined> {
    const [row] = await this.db
      .select({
        ...getTableColumns(agent),
        pinned: sql<boolean>`${agent_pin.id} is not null`.as("pinned"),
      })
      .from(agent)
      .innerJoin(organization, eq(agent.organization_id, organization.id))
      .leftJoin(
        agent_pin,
        and(
          eq(agent_pin.agent_id, agent.id),
          params.userID ? eq(agent_pin.user_id, params.userID) : undefined
        )
      )
      .where(
        and(
          eq(agent.name, params.agentName),
          ilike(organization.name, params.organizationName)
        )
      );
    return row;
  }

  public async selectAgentByOrganizationIDAndName(params: {
    organizationID: string;
    name: string;
  }): Promise<Agent | undefined> {
    const [row] = await this.db
      .select()
      .from(agent)
      .where(
        and(
          eq(agent.organization_id, params.organizationID),
          eq(agent.name, params.name)
        )
      );
    return row;
  }

  public async selectAgentDailyChats({ agentID }: { agentID: string }) {
    let rows = await this.db.execute(sql`
      WITH bounds AS (
        SELECT date_trunc('day', now() - interval '29 days') AS start_ts,
               date_trunc('day', now())                      AS end_ts
      ),
      series AS (
        SELECT generate_series(start_ts, end_ts, interval '1 day') AS bucket
        FROM bounds
      ),
      agg AS (
        SELECT date_bin('1 day', ${chat_run_step.started_at}, timestamptz '1970-01-01') AS bucket,
               COUNT(DISTINCT ${chat_run_step.chat_id}) AS unique_chats
        FROM ${chat_run_step}
        WHERE ${chat_run_step.agent_id} = ${agentID}
          AND ${chat_run_step.started_at} >= (SELECT start_ts FROM bounds)
        GROUP BY 1
      )
      SELECT s.bucket AS interval, COALESCE(a.unique_chats, 0) AS unique_chats
      FROM series s
      LEFT JOIN agg a USING (bucket)
      ORDER BY s.bucket;
      `);

    // For some reason in Neon this works differently than locally...
    if ("rows" in rows) {
      rows = rows.rows;
    }

    return rows.map((r: { interval: string; unique_chats: number }) => ({
      interval: new Date(r.interval).toISOString(),
      unique_chats: Number(r.unique_chats),
    }));
  }

  public async selectAgentDailyChatsForOrganization({
    organizationID,
  }: {
    organizationID: string;
  }) {
    let rows = await this.db.execute(sql`
      WITH bounds AS (
        SELECT date_trunc('day', now() - interval '6 days') AS start_ts,
               date_trunc('day', now())                      AS end_ts
      ),
      series AS (
        SELECT generate_series(start_ts, end_ts, interval '1 day') AS bucket
        FROM bounds
      ),
      org_agents AS (
        SELECT ${agent.id} as agent_id
        FROM ${agent}
        WHERE ${agent.organization_id} = ${organizationID}
      ),
      agg AS (
        SELECT ${chat_run_step.agent_id},
               date_bin('1 day', ${chat_run_step.started_at}, timestamptz '1970-01-01') AS bucket,
               COUNT(DISTINCT ${chat_run_step.chat_id}) AS unique_chats
        FROM ${chat_run_step}
        INNER JOIN org_agents ON org_agents.agent_id = ${chat_run_step.agent_id}
        WHERE ${chat_run_step.started_at} >= (SELECT start_ts FROM bounds)
        GROUP BY 1, 2
      ),
      daily_series AS (
        SELECT org_agents.agent_id, s.bucket
        FROM org_agents
        CROSS JOIN series s
      )
      SELECT ds.agent_id, ds.bucket AS interval, COALESCE(a.unique_chats, 0) AS unique_chats
      FROM daily_series ds
      LEFT JOIN agg a ON a.agent_id = ds.agent_id AND a.bucket = ds.bucket
      ORDER BY ds.agent_id, ds.bucket;
    `);

    // For some reason in Neon this works differently than locally...
    if ("rows" in rows) {
      rows = rows.rows;
    }

    // Group by agent_id
    const result = new Map<
      string,
      Array<{ interval: string; unique_chats: number }>
    >();

    for (const r of rows as Array<{
      agent_id: string;
      interval: string;
      unique_chats: number;
    }>) {
      if (!result.has(r.agent_id)) {
        result.set(r.agent_id, []);
      }
      result.get(r.agent_id)!.push({
        interval: new Date(r.interval).toISOString(),
        unique_chats: Number(r.unique_chats),
      });
    }

    return result;
  }

  public async selectAgentIntervalStats({
    agentID,
    since,
  }: {
    agentID: string;
    since: Date;
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '15 minutes', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        unique_chats: countDistinct(chat_run_step.chat_id),
        unique_steps: countDistinct(chat_run_step.id), // total unique steps (i.e., total rows)
        error_steps: sql<number>`count(*) filter (where ${chat_run_step.error} is not null)`,
        completed_steps: sql<number>`count(*) filter (where ${chat_run_step.completed_at} is not null)`,
        tool_calls_total: sql<number>`sum(${chat_run_step.tool_calls_total})`,
        tool_calls_completed: sql<number>`sum(${chat_run_step.tool_calls_completed})`,
        tool_calls_errored: sql<number>`sum(${chat_run_step.tool_calls_errored})`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, since)
        )
      )
      .groupBy(chat_run_step.agent_id, intervalExpr)
      .orderBy(intervalExpr);
    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      unique_chats: r.unique_chats,
      unique_steps: r.unique_steps,
      error_steps: Number(r.error_steps),
      completed_steps: Number(r.completed_steps),
      tool_calls_total: Number(r.tool_calls_total),
      tool_calls_completed: Number(r.tool_calls_completed),
      tool_calls_errored: Number(r.tool_calls_errored),
    }));
  }

  public async selectAgentDailyChatsRange({
    agentID,
    startDate,
    endDate,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '1 day', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        unique_chats: countDistinct(chat_run_step.chat_id),
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate)
        )
      )
      .groupBy(intervalExpr)
      .orderBy(intervalExpr);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      unique_chats: r.unique_chats,
    }));
  }

  public async selectAgentTokenUsageStats({
    agentID,
    startDate,
    endDate,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
  }) {
    const result = await this.db
      .select({
        total_input_tokens: sql<number>`sum(${chat_run_step.usage_total_input_tokens})`,
        total_output_tokens: sql<number>`sum(${chat_run_step.usage_total_output_tokens})`,
        total_cached_tokens: sql<number>`sum(${chat_run_step.usage_total_cached_input_tokens})`,
        avg_ttft_ms: sql<number>`avg(${chat_run_step.time_to_first_token_micros}) / 1000`,
        models: sql<
          string[]
        >`array_agg(distinct ${chat_run_step.usage_model}) filter (where ${chat_run_step.usage_model} is not null)`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate)
        )
      );

    if (!result[0]) {
      return {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cached_tokens: 0,
        avg_ttft_ms: 0,
        models: [],
      };
    }

    return {
      total_input_tokens: Number(result[0].total_input_tokens || 0),
      total_output_tokens: Number(result[0].total_output_tokens || 0),
      total_cached_tokens: Number(result[0].total_cached_tokens || 0),
      avg_ttft_ms: Number(result[0].avg_ttft_ms || 0),
      models: result[0].models || [],
    };
  }

  public async selectAgentRuntimeDailySummary({
    agentID,
    startDate,
    endDate,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '1 day', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        runtime_seconds: sql<number>`sum(extract(epoch from (coalesce(${chat_run_step.completed_at}, ${chat_run_step.interrupted_at}, now()) - ${chat_run_step.started_at})))`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate)
        )
      )
      .groupBy(intervalExpr)
      .orderBy(intervalExpr);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      runtime_seconds: Number(r.runtime_seconds || 0),
    }));
  }

  public async selectAgentTokenUsageByModelDaily({
    agentID,
    startDate,
    endDate,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '1 day', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        model: chat_run_step.usage_model,
        input_tokens: sql<number>`sum(${chat_run_step.usage_total_input_tokens})`,
        output_tokens: sql<number>`sum(${chat_run_step.usage_total_output_tokens})`,
        cached_tokens: sql<number>`sum(${chat_run_step.usage_total_cached_input_tokens})`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate),
          isNotNull(chat_run_step.usage_model)
        )
      )
      .groupBy(intervalExpr, chat_run_step.usage_model)
      .orderBy(intervalExpr, chat_run_step.usage_model);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      model: r.model!,
      input_tokens: Number(r.input_tokens || 0),
      output_tokens: Number(r.output_tokens || 0),
      cached_tokens: Number(r.cached_tokens || 0),
    }));
  }

  public async selectAgentTTFTByModelDaily({
    agentID,
    startDate,
    endDate,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '1 day', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        model: chat_run_step.usage_model,
        avg_ttft_ms: sql<number>`avg(${chat_run_step.time_to_first_token_micros}) / 1000`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate),
          isNotNull(chat_run_step.usage_model),
          isNotNull(chat_run_step.time_to_first_token_micros)
        )
      )
      .groupBy(intervalExpr, chat_run_step.usage_model)
      .orderBy(intervalExpr, chat_run_step.usage_model);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      model: r.model!,
      avg_ttft_ms: Number(r.avg_ttft_ms || 0),
    }));
  }

  public async selectAgentChatsWithGranularity({
    agentID,
    startDate,
    endDate,
    granularity,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
    granularity: "1 hour" | "1 day";
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '${sql.raw(granularity)}', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        unique_chats: countDistinct(chat_run_step.chat_id),
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate)
        )
      )
      .groupBy(intervalExpr)
      .orderBy(intervalExpr);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      unique_chats: r.unique_chats,
    }));
  }

  public async selectAgentRuntimeWithGranularity({
    agentID,
    startDate,
    endDate,
    granularity,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
    granularity: "1 hour" | "1 day";
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '${sql.raw(granularity)}', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        runtime_seconds: sql<number>`sum(extract(epoch from (coalesce(${chat_run_step.completed_at}, ${chat_run_step.interrupted_at}, now()) - ${chat_run_step.started_at})))`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate)
        )
      )
      .groupBy(intervalExpr)
      .orderBy(intervalExpr);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      runtime_seconds: Number(r.runtime_seconds || 0),
    }));
  }

  public async selectAgentTokenUsageByModelWithGranularity({
    agentID,
    startDate,
    endDate,
    granularity,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
    granularity: "1 hour" | "1 day";
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '${sql.raw(granularity)}', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        model: chat_run_step.usage_model,
        input_tokens: sql<number>`sum(${chat_run_step.usage_total_input_tokens})`,
        output_tokens: sql<number>`sum(${chat_run_step.usage_total_output_tokens})`,
        cached_tokens: sql<number>`sum(${chat_run_step.usage_total_cached_input_tokens})`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate),
          isNotNull(chat_run_step.usage_model)
        )
      )
      .groupBy(intervalExpr, chat_run_step.usage_model)
      .orderBy(intervalExpr, chat_run_step.usage_model);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      model: r.model!,
      input_tokens: Number(r.input_tokens || 0),
      output_tokens: Number(r.output_tokens || 0),
      cached_tokens: Number(r.cached_tokens || 0),
    }));
  }

  public async selectAgentTTFTByModelWithGranularity({
    agentID,
    startDate,
    endDate,
    granularity,
  }: {
    agentID: string;
    startDate: Date;
    endDate: Date;
    granularity: "1 hour" | "1 day";
  }) {
    const intervalExpr = sql<Date>`date_bin(interval '${sql.raw(granularity)}', ${chat_run_step.started_at}, timestamptz '1970-01-01 00:00:00+00')`;

    const rows = await this.db
      .select({
        interval: intervalExpr,
        model: chat_run_step.usage_model,
        avg_ttft_ms: sql<number>`avg(${chat_run_step.time_to_first_token_micros}) / 1000`,
      })
      .from(chat_run_step)
      .where(
        and(
          eq(chat_run_step.agent_id, agentID),
          gte(chat_run_step.started_at, startDate),
          lte(chat_run_step.started_at, endDate),
          isNotNull(chat_run_step.usage_model),
          isNotNull(chat_run_step.time_to_first_token_micros)
        )
      )
      .groupBy(intervalExpr, chat_run_step.usage_model)
      .orderBy(intervalExpr, chat_run_step.usage_model);

    return rows.map((r) => ({
      interval: new Date(r.interval).toISOString(),
      model: r.model!,
      avg_ttft_ms: Number(r.avg_ttft_ms || 0),
    }));
  }

  public async selectOrganizationMembership({
    userID,
    organizationID,
  }: {
    userID: string;
    organizationID: string;
  }): Promise<OrganizationMembership | undefined> {
    const [row] = await this.db
      .select()
      .from(organization_membership)
      .where(
        and(
          eq(organization_membership.user_id, userID),
          eq(organization_membership.organization_id, organizationID)
        )
      );
    return row;
  }

  public async insertOrganizationWithMembership(
    arg: Insertable<typeof organization>
  ): Promise<OrganizationWithMembership> {
    if (!arg.created_by) {
      throw new Error("created_by is required");
    }

    // Check if the organization name is reserved
    if (
      arg.name &&
      typeof arg.name === "string" &&
      reserved_usernames.has(arg.name)
    ) {
      throw new Error(`Username "${arg.name}" is reserved and cannot be used.`);
    }

    return this.tx(async (tx) => {
      const [org] = await tx.db.insert(organization).values(arg).returning();
      if (!org) {
        throw new Error("Failed to create organization");
      }
      const [membership] = await tx.db
        .insert(organization_membership)
        .values({
          organization_id: org.id,
          user_id: arg.created_by!,
          role: "owner",
          billing_emails_opt_out: false,
        })
        .returning();
      if (!membership) {
        throw new Error("Failed to create organization membership");
      }
      return {
        ...org,
        membership,
      };
    });
  }

  public async insertOrganizationMembership(
    arg: Insertable<typeof organization_membership>
  ): Promise<OrganizationMembership> {
    const [membership] = await this.db
      .insert(organization_membership)
      .values(arg)
      .returning();
    return membership!;
  }

  public async updateOrganizationInvite(
    id: string,
    updates: Partial<OrganizationInvite>
  ): Promise<OrganizationInvite> {
    const [invite] = await this.db
      .update(organization_invite)
      .set(updates)
      .where(eq(organization_invite.id, id))
      .returning();
    return invite!;
  }

  public async deleteOrganization(params: { id: string }): Promise<void> {
    await this.db.delete(organization).where(eq(organization.id, params.id));
  }

  public async selectAgentByID(id: string): Promise<Agent | undefined> {
    return this.db
      .select()
      .from(agent)
      .where(eq(agent.id, id))
      .then((res) => res[0]);
  }

  public async deleteAgent(params: { id: string }): Promise<void> {
    await this.db.delete(agent).where(eq(agent.id, params.id));
  }

  public async selectAgentsByOrganizationID(
    params: Paginated<{ organizationID: string; userID: string }>
  ) {
    return withPagination(
      this.db
        .select({
          ...getTableColumns(agent),
          active_deployment_created_by: sql<string | null>`(
            SELECT created_by 
            FROM ${agent_deployment} 
            WHERE ${agent_deployment.id} = ${agent.active_deployment_id}
          )`.as("active_deployment_created_by"),
          active_deployment_created_at: sql<Date | null>`(
            SELECT created_at 
            FROM ${agent_deployment} 
            WHERE ${agent_deployment.id} = ${agent.active_deployment_id}
          )`.as("active_deployment_created_at"),
        })
        .from(agent)
        .leftJoin(
          organization_membership,
          and(
            eq(agent.organization_id, organization_membership.organization_id),
            eq(organization_membership.user_id, params.userID)
          )
        )
        .leftJoin(
          agent_permission,
          and(
            eq(agent_permission.agent_id, agent.id),
            eq(agent_permission.user_id, params.userID)
          )
        )
        .where(
          and(
            eq(agent.organization_id, params.organizationID),
            // Visibility filter: same logic as selectAgentsForUser
            // - organization/public: visible to all org members
            // - private: visible only to org admins/owners or users with explicit permission
            sql`(
              ${agent.visibility} IN ('organization', 'public')
              OR (
                ${agent.visibility} = 'private' 
                AND (
                  ${organization_membership.role} IN ('owner', 'admin')
                  OR ${agent_permission.id} IS NOT NULL
                )
              )
            )`
          )
        )
        .$dynamic(),
      // Sort by active deployment time (most recent first), then by agent creation.
      sql`active_deployment_created_at DESC NULLS LAST, ${agent.created_at} DESC`,
      params
    );
  }

  public async deleteAgentPin(params: {
    agentID: string;
    userID: string;
  }): Promise<void> {
    await this.db
      .delete(agent_pin)
      .where(
        and(
          eq(agent_pin.agent_id, params.agentID),
          eq(agent_pin.user_id, params.userID)
        )
      );
  }

  public async insertAgentPin(params: Insertable<typeof agent_pin>) {
    const [created] = await this.db
      .insert(agent_pin)
      .values(params)
      .returning();
    return created!;
  }

  public async selectAgentsForUser(
    params: Paginated<{
      userID: string;
      organizationID?: string;
      pinned?: boolean;
    }>
  ) {
    return withPagination(
      // Select from all organizations the user is a member of.
      // Respects visibility:
      // - organization: visible to all org members
      // - private: visible only to org admins/owners or users with explicit permission
      // - public: visible to everyone (not exposed in UI yet)
      this.db
        .select({
          ...getTableColumns(agent),
          pinned: sql<boolean>`${agent_pin.id} is not null`.as("pinned"),
          pinned_at: sql<Date>`${agent_pin.created_at}`.as("pinned_at"),
          active_deployment_created_by: sql<string | null>`(
            SELECT created_by 
            FROM ${agent_deployment} 
            WHERE ${agent_deployment.id} = ${agent.active_deployment_id}
          )`.as("active_deployment_created_by"),
          active_deployment_created_at: sql<Date | null>`(
            SELECT created_at 
            FROM ${agent_deployment} 
            WHERE ${agent_deployment.id} = ${agent.active_deployment_id}
          )`.as("active_deployment_created_at"),
        })
        .from(agent)
        .innerJoin(
          organization_membership,
          eq(agent.organization_id, organization_membership.organization_id)
        )
        .leftJoin(
          agent_pin,
          and(
            eq(agent_pin.agent_id, agent.id),
            eq(agent_pin.user_id, params.userID)
          )
        )
        .leftJoin(
          agent_permission,
          and(
            eq(agent_permission.agent_id, agent.id),
            eq(agent_permission.user_id, params.userID)
          )
        )
        .where(
          and(
            eq(organization_membership.user_id, params.userID),
            params.organizationID
              ? eq(agent.organization_id, params.organizationID)
              : undefined,
            typeof params.pinned === "boolean"
              ? params.pinned
                ? isNotNull(agent_pin.id)
                : isNull(agent_pin.id)
              : undefined,
            // Visibility filter:
            // - organization/public: visible to all org members
            // - private: visible only to org admins/owners or users with explicit permission
            sql`(
              ${agent.visibility} IN ('organization', 'public')
              OR (
                ${agent.visibility} = 'private' 
                AND (
                  ${organization_membership.role} IN ('owner', 'admin')
                  OR ${agent_permission.id} IS NOT NULL
                )
              )
            )`
          )
        )
        .$dynamic(),
      sql`pinned DESC, pinned_at DESC NULLS LAST, ${agent.created_at} DESC, ${agent.id} DESC`,
      params
    );
  }

  public async insertAgent(arg: Insertable<typeof agent>) {
    const [created] = await this.db.insert(agent).values(arg).returning();
    return created!;
  }

  public async insertAgentDeployment(
    arg: Insertable<typeof agent_deployment, "number">
  ) {
    const [created] = await this.db
      .insert(agent_deployment)
      .values(arg as Insertable<typeof agent_deployment>)
      .returning();
    return created!;
  }

  public async selectAgentDeploymentByIDOrActive({
    agentID,
    id,
  }: {
    agentID: string;
    id?: string | null;
  }) {
    if (id != null) {
      return this.db
        .select()
        .from(agent_deployment)
        .where(
          and(
            eq(agent_deployment.agent_id, agentID),
            eq(agent_deployment.id, id)
          )
        )
        .limit(1)
        .then((res) => res[0] ?? null);
    }

    return this.db
      .select({ deployment: agent_deployment })
      .from(agent)
      .innerJoin(
        agent_deployment,
        and(
          eq(agent.id, agent_deployment.agent_id),
          eq(agent.active_deployment_id, agent_deployment.id)
        )
      )
      .where(eq(agent.id, agentID))
      .limit(1)
      .then((res) => res[0]?.deployment ?? null);
  }

  public async selectAgentDeploymentsByAgentID(
    opts: Paginated<{ agentID: string }>
  ) {
    return withPagination(
      this.db
        .select({
          ...getTableColumns(agent_deployment),
          target: agent_deployment_target.target,
        })
        .from(agent_deployment)
        .where(eq(agent_deployment.agent_id, opts.agentID))
        .innerJoin(
          agent_deployment_target,
          eq(agent_deployment.target_id, agent_deployment_target.id)
        )
        .$dynamic(),
      sql`${agent_deployment.number} DESC`,
      opts
    );
  }

  public async insertAgentEnvironmentVariable(
    arg: Insertable<typeof agent_environment_variable>
  ) {
    let values = arg;

    // Always encrypt the value if master key is available
    const masterKey = getMasterKey();
    if (arg.value && typeof arg.value === "string" && masterKey) {
      const encrypted = await encryptValue(arg.value, masterKey);
      values = {
        ...arg,
        value: null,
        encrypted_value: encrypted.encryptedValue.toString("base64"),
        encrypted_dek: encrypted.encryptedDEK.toString("base64"),
        encryption_iv: encrypted.encryption_iv.toString("base64"),
        encryption_auth_tag: encrypted.encryption_auth_tag.toString("base64"),
      };
    }

    const [created] = await this.db
      .insert(agent_environment_variable)
      .values(values)
      .returning();
    return this.decryptEnvVar(created!);
  }

  // Helper to decrypt environment variable if needed
  private async decryptEnvVar(
    envVar: AgentEnvironmentVariable
  ): Promise<AgentEnvironmentVariable> {
    // If value is already in plaintext (legacy data), return as-is
    if (envVar.value !== null) {
      return envVar;
    }

    // Decrypt encrypted fields
    if (
      envVar.encrypted_value &&
      envVar.encrypted_dek &&
      envVar.encryption_iv &&
      envVar.encryption_auth_tag
    ) {
      const masterKey = getMasterKey();
      if (!masterKey) {
        throw new Error(
          "ENCRYPTION_MASTER_KEY not configured. Cannot decrypt environment variable."
        );
      }

      try {
        const decrypted = await decryptValue(
          {
            encryptedValue: Buffer.from(envVar.encrypted_value, "base64"),
            encryptedDEK: Buffer.from(envVar.encrypted_dek, "base64"),
            encryption_iv: Buffer.from(envVar.encryption_iv, "base64"),
            encryption_auth_tag: Buffer.from(
              envVar.encryption_auth_tag,
              "base64"
            ),
          },
          masterKey
        );

        return {
          ...envVar,
          value: decrypted,
        };
      } catch (error) {
        console.error("Failed to decrypt environment variable:", error);
        throw new Error(
          "Failed to decrypt environment variable. This may indicate a wrong encryption key or corrupted data."
        );
      }
    }

    // If no value and no encrypted fields, something is wrong
    throw new Error(
      "Environment variable has no value - neither plaintext nor encrypted data found"
    );
  }

  public async deleteAgentEnvironmentVariable(id: string) {
    await this.db
      .delete(agent_environment_variable)
      .where(eq(agent_environment_variable.id, id));
  }

  public async selectAgentEnvironmentVariableByID(id: string) {
    const result = await this.db
      .select()
      .from(agent_environment_variable)
      .where(eq(agent_environment_variable.id, id))
      .then((res) => res[0]);

    if (!result) return result;
    return this.decryptEnvVar(result);
  }

  public async updateAgentEnvironmentVariable(
    id: string,
    updates: Partial<AgentEnvironmentVariable>
  ) {
    let values = updates;

    // Always encrypt value if being updated and master key is available
    const masterKey = getMasterKey();
    if (updates.value && typeof updates.value === "string" && masterKey) {
      const encrypted = await encryptValue(updates.value, masterKey);
      values = {
        ...updates,
        value: null,
        encrypted_value: encrypted.encryptedValue.toString("base64"),
        encrypted_dek: encrypted.encryptedDEK.toString("base64"),
        encryption_iv: encrypted.encryption_iv.toString("base64"),
        encryption_auth_tag: encrypted.encryption_auth_tag.toString("base64"),
      };
    }

    const result = await this.db
      .update(agent_environment_variable)
      .set(values)
      .where(eq(agent_environment_variable.id, id))
      .returning()
      .then((res) => res[0]!);

    return this.decryptEnvVar(result);
  }

  public async updateAgentEnvironmentVariableByKey(
    agentID: string,
    key: string,
    updates: Partial<AgentEnvironmentVariable>
  ) {
    let values = updates;

    // Always encrypt value if being updated and master key is available
    const masterKey2 = getMasterKey();
    if (updates.value && typeof updates.value === "string" && masterKey2) {
      const encrypted = await encryptValue(updates.value, masterKey2);
      values = {
        ...updates,
        value: null,
        encrypted_value: encrypted.encryptedValue.toString("base64"),
        encrypted_dek: encrypted.encryptedDEK.toString("base64"),
        encryption_iv: encrypted.encryption_iv.toString("base64"),
        encryption_auth_tag: encrypted.encryption_auth_tag.toString("base64"),
      };
    }

    const result = await this.db
      .update(agent_environment_variable)
      .set(values)
      .where(
        and(
          eq(agent_environment_variable.agent_id, agentID),
          eq(agent_environment_variable.key, key)
        )
      )
      .returning()
      .then((res) => res[0]!);

    return this.decryptEnvVar(result);
  }

  public async selectAgentEnvironmentVariablesByAgentID({
    agentID,
    target = ["preview", "production"],
  }: {
    agentID: string;
    target?: AgentEnvDeploymentTarget[];
  }) {
    const results = await this.db
      .select()
      .from(agent_environment_variable)
      .where(
        and(
          eq(agent_environment_variable.agent_id, agentID),
          (() => {
            const anyTargets = target.map(
              (t) => sql`${t} = ANY(${agent_environment_variable.target})`
            );
            return anyTargets.length === 1 ? anyTargets[0]! : or(...anyTargets);
          })()
        )
      );

    // Decrypt all environment variables
    return Promise.all(results.map((envVar) => this.decryptEnvVar(envVar)));
  }

  public async selectOrganizationMembers(
    params: Paginated<{
      organizationID: string;
      query?: string;
      orderBy?: "role" | "name" | "created_at";
      orderDirection?: "asc" | "desc";
    }>
  ) {
    const conditions = [
      eq(organization_membership.organization_id, params.organizationID),
    ];

    if (params.query) {
      const searchPattern = `%${params.query}%`;
      conditions.push(
        or(
          ilike(user_with_personal_organization.username, searchPattern),
          ilike(user_with_personal_organization.display_name, searchPattern),
          ilike(user_with_personal_organization.email, searchPattern)
        )!
      );
    }

    const direction = params.orderDirection ?? "asc";
    const isDesc = direction === "desc";

    // Determine order by clause
    let orderByClause;
    switch (params.orderBy) {
      case "role":
        // Role hierarchy: owner=1, admin=2, billing_admin=3, member=4 for asc (highest first)
        // Reverse for desc
        orderByClause = isDesc
          ? sql`CASE 
              WHEN ${organization_membership.role} = 'member' THEN 1 
              WHEN ${organization_membership.role} = 'billing_admin' THEN 2 
              WHEN ${organization_membership.role} = 'admin' THEN 3 
              WHEN ${organization_membership.role} = 'owner' THEN 4 
            END, ${user_with_personal_organization.display_name} DESC NULLS LAST, ${user_with_personal_organization.username} DESC`
          : sql`CASE 
              WHEN ${organization_membership.role} = 'owner' THEN 1 
              WHEN ${organization_membership.role} = 'admin' THEN 2 
              WHEN ${organization_membership.role} = 'billing_admin' THEN 3 
              WHEN ${organization_membership.role} = 'member' THEN 4 
            END, ${user_with_personal_organization.display_name} ASC NULLS LAST, ${user_with_personal_organization.username} ASC`;
        break;
      case "name":
        orderByClause = isDesc
          ? sql`${user_with_personal_organization.display_name} DESC NULLS LAST, ${user_with_personal_organization.username} DESC`
          : sql`${user_with_personal_organization.display_name} ASC NULLS LAST, ${user_with_personal_organization.username} ASC`;
        break;
      case "created_at":
        orderByClause = isDesc
          ? sql`${organization_membership.created_at} DESC`
          : sql`${organization_membership.created_at} ASC`;
        break;
      default:
        orderByClause = sql`${organization_membership.created_at} DESC`;
        break;
    }

    return withPagination(
      this.db
        .select({
          organization_id: organization_membership.organization_id,
          user_id: organization_membership.user_id,
          role: organization_membership.role,
          billing_emails_opt_out:
            organization_membership.billing_emails_opt_out,
          created_at: organization_membership.created_at,
          updated_at: organization_membership.updated_at,
          user: {
            id: user_with_personal_organization.id,
            created_at: user_with_personal_organization.created_at,
            updated_at: user_with_personal_organization.updated_at,
            username: user_with_personal_organization.username,
            display_name: user_with_personal_organization.display_name,
            email: user_with_personal_organization.email,
            avatar_url: user_with_personal_organization.avatar_url,
            organization_id: sql<string>`"user_with_personal_organization"."organization_id"`,
          },
        })
        .from(organization_membership)
        .innerJoin(
          user_with_personal_organization,
          eq(
            organization_membership.user_id,
            user_with_personal_organization.id
          )
        )
        .where(and(...conditions))
        .$dynamic(),
      orderByClause,
      params
    );
  }

  public async selectAllUsers(
    params: Paginated<{
      query?: string;
      siteRole?: "admin" | "member";
    }>
  ) {
    const conditions: SQL[] = [];

    if (params.query) {
      const searchPattern = `%${params.query}%`;
      const searchCondition = or(
        ilike(user_with_personal_organization.username, searchPattern),
        ilike(user_with_personal_organization.display_name, searchPattern),
        ilike(user_with_personal_organization.email, searchPattern)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (params.siteRole) {
      conditions.push(
        eq(user_with_personal_organization.site_role, params.siteRole)
      );
    }

    return withPagination(
      this.db
        .select({
          id: user_with_personal_organization.id,
          created_at: user_with_personal_organization.created_at,
          updated_at: user_with_personal_organization.updated_at,
          username: user_with_personal_organization.username,
          display_name: user_with_personal_organization.display_name,
          email: user_with_personal_organization.email,
          avatar_url: user_with_personal_organization.avatar_url,
          organization_id: sql<string>`"user_with_personal_organization"."organization_id"`,
          site_role: user_with_personal_organization.site_role,
        })
        .from(user_with_personal_organization)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .$dynamic(),
      sql`${user_with_personal_organization.created_at} DESC`,
      params
    );
  }

  public async selectOrganizationInviteByID(
    id: string
  ): Promise<OrganizationInvite | undefined> {
    return this.db
      .select()
      .from(organization_invite)
      .where(eq(organization_invite.id, id))
      .then((res) => res[0]);
  }

  public async selectOrganizationInviteByCode(code: string): Promise<
    | {
        invite: OrganizationInvite;
        organization: Organization;
      }
    | undefined
  > {
    const [row] = await this.db
      .select()
      .from(organization_invite)
      .innerJoin(
        organization,
        eq(organization_invite.organization_id, organization.id)
      )
      .where(eq(organization_invite.code, code));

    if (!row) {
      return undefined;
    }

    return {
      invite: row.organization_invite,
      organization: row.organization,
    };
  }

  public async deleteOrganizationInvite(id: string): Promise<void> {
    await this.db
      .delete(organization_invite)
      .where(eq(organization_invite.id, id));
  }

  public async updateOrganizationMembership(
    updates: Pick<OrganizationMembership, "user_id" | "organization_id"> &
      Partial<OrganizationMembership>
  ): Promise<OrganizationMembership> {
    const [membership] = await this.db
      .update(organization_membership)
      .set({
        updated_at: new Date(),
        ...updates,
      })
      .where(
        and(
          eq(organization_membership.user_id, updates.user_id),
          eq(organization_membership.organization_id, updates.organization_id)
        )
      )
      .returning();
    return membership!;
  }

  /**
   * selectChats returns a paginated list of chats sorted however a user specified.
   */
  public async selectChats(
    params: CursorPaginated<
      | {
          organizationID: string;
          status?: ChatStatus;
          agentID?: string;
          createdBy?: string;
        }
      | {
          agentID: string;
          status?: ChatStatus;
          createdBy?: string;
        }
    >
  ) {
    const equals: SQL[] = [];
    if ("organizationID" in params && params.organizationID) {
      equals.push(eq(chat_with_status.organization_id, params.organizationID));
    }
    if ("agentID" in params && params.agentID) {
      equals.push(eq(chat_with_status.agent_id, params.agentID));
    }
    if ("createdBy" in params && params.createdBy) {
      equals.push(eq(chat_with_status.created_by, params.createdBy));
    }
    if (equals.length === 0) {
      throw new Error("No organization or agent ID provided");
    }

    // We need to omit updated_at here because Drizzle doesn't support aliasing the same column name. We add it back later.
    const { updated_at, ...rest } = getViewSelectedFields(chat_with_status);

    const results = await withCursorPagination(
      this.db
        .select({
          ...rest,
          chat_updated_at: sql<Date>`"chat_with_status"."updated_at"`.as(
            "chat_updated_at"
          ),
          agent: getTableColumns(agent),
        })
        .from(chat_with_status)
        .innerJoin(agent, eq(chat_with_status.agent_id, agent.id))
        .$dynamic(),
      {
        idColumn: chat_with_status.id,
        sortExpr: sql`"chat_with_status"."updated_at"`,
        direction: "desc",
        baseWhere: and(...equals, isNotNull(chat_with_status.agent_id)),
        getKey: (row) => ({
          ts: parseDbTimestamp(row.chat_updated_at),
          id: row.id,
        }),
      },
      params
    );
    return {
      ...results,
      items: results.items.map((item) => ({
        ...item,
        updated_at: parseDbTimestamp(item.chat_updated_at),
      })),
    };
  }

  public async selectChatMessages(
    params: CursorPaginated<{
      chatID: string;
    }>
  ) {
    return withCursorPagination(
      this.db.select().from(message).$dynamic(),
      {
        idColumn: message.id,
        sortExpr: message.created_at,
        direction: "desc",
        baseWhere: eq(message.chat_id, params.chatID),
        getKey: (row) => ({
          ts: row.created_at,
          id: row.id,
        }),
      },
      params
    );
  }

  public async selectAgentDeploymentTargetByID(
    id: string
  ): Promise<AgentDeploymentTarget | undefined> {
    return this.db
      .select()
      .from(agent_deployment_target)
      .where(eq(agent_deployment_target.id, id))
      .then((res) => res[0]);
  }

  public async selectAgentDeploymentTargetByName(
    agentID: string,
    target: string
  ) {
    return this.db
      .select()
      .from(agent_deployment_target)
      .where(
        and(
          eq(agent_deployment_target.agent_id, agentID),
          eq(agent_deployment_target.target, target)
        )
      )
      .then((res) => res[0]);
  }

  public async updateAgentDeploymentTarget(
    id: string,
    updates: { request_id?: string }
  ) {
    const [updated] = await this.db
      .update(agent_deployment_target)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(agent_deployment_target.id, id))
      .returning();
    return updated!;
  }

  public async selectAgentDeploymentByID(
    id: string
  ): Promise<(AgentDeployment & { target: string }) | null> {
    return this.db
      .select({
        ...getTableColumns(agent_deployment),
        target: agent_deployment_target.target,
      })
      .from(agent_deployment)
      .innerJoin(
        agent_deployment_target,
        eq(agent_deployment.target_id, agent_deployment_target.id)
      )
      .where(eq(agent_deployment.id, id))
      .then((res) => res[0] ?? null);
  }

  public async selectAgentDeploymentByNumber(
    agentID: string,
    number: number
  ): Promise<(AgentDeployment & { target: string }) | null> {
    return this.db
      .select({
        ...getTableColumns(agent_deployment),
        target: agent_deployment_target.target,
      })
      .from(agent_deployment)
      .innerJoin(
        agent_deployment_target,
        eq(agent_deployment.target_id, agent_deployment_target.id)
      )
      .where(
        and(
          eq(agent_deployment.agent_id, agentID),
          eq(agent_deployment.number, number)
        )
      )
      .then((res) => res[0] ?? null);
  }

  public async deleteChatMessage(id: string): Promise<void> {
    await this.db.delete(message).where(eq(message.id, id));
  }

  public async deleteChatMessages(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(message).where(inArray(message.id, ids));
  }

  public async updateChatMessage(
    updates: Pick<DBMessage, "id"> & Partial<DBMessage>
  ): Promise<DBMessage> {
    const [resp] = await this.db
      .update(message)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(message.id, updates.id))
      .returning();
    return resp!;
  }

  public async selectAgentDeploymentByRequestID(id: string) {
    return this.db
      .select()
      .from(agent)
      .leftJoin(
        agent_deployment,
        eq(agent.active_deployment_id, agent_deployment.id)
      )
      .leftJoin(
        agent_deployment_target,
        eq(agent_deployment_target.agent_id, agent.id)
      )
      .where(eq(agent_deployment_target.request_id, id))
      .then((res) => (res.length > 0 ? res[0] : undefined));
  }

  public async updateAgent(updates: Pick<Agent, "id"> & Partial<Agent>) {
    const [updated] = await this.db
      .update(agent)
      .set(updates)
      .where(eq(agent.id, updates.id))
      .returning();
    return updated!;
  }

  public async updateAgentDeployment(
    updates: Pick<AgentDeployment, "id"> & Partial<AgentDeployment>
  ) {
    await this.db
      .update(agent_deployment)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(and(eq(agent_deployment.id, updates.id)));
  }

  public async selectMessagesByChatID(chatID: string) {
    return this.db
      .select()
      .from(message)
      .where(and(eq(message.chat_id, chatID)))
      .orderBy(asc(message.created_at));
  }

  public async selectLatestChatRun(chatID: string) {
    return this.db
      .select({
        run: getTableColumns(chat_run),
        step: getViewSelectedFields(chat_run_step_with_status),
      })
      .from(chat_run)
      .innerJoin(chat, eq(chat.id, chat_run.chat_id))
      .leftJoin(
        chat_run_step_with_status,
        and(
          eq(chat_run_step_with_status.chat_run_id, chat_run.id),
          eq(chat_run_step_with_status.number, chat_run.last_step_number)
        )
      )
      .where(
        and(eq(chat.id, chatID), eq(chat.last_run_number, chat_run.number))
      )
      .limit(1)
      .then((res) => res[0]);
  }

  public async updateChatRun(updates: Pick<ChatRun, "id"> & Partial<ChatRun>) {
    return this.db
      .update(chat_run)
      .set(updates)
      .where(and(eq(chat_run.id, updates.id)))
      .returning()
      .then((res) => res[0]!);
  }

  public async insertChatRunStep(
    arg: Insertable<typeof chat_run_step, "number">,
    ignoreOnConstraint?: boolean
  ) {
    if (ignoreOnConstraint) {
      return this.db
        .insert(chat_run_step)
        .values(arg as Insertable<typeof chat_run_step>)
        .onConflictDoNothing({
          target: [chat_run_step.chat_id],
          where: sql`${chat_run_step.completed_at} IS NULL AND ${chat_run_step.error} IS NULL AND ${chat_run_step.interrupted_at} IS NULL`,
        })
        .returning()
        .then((res) => res[0]!);
    } else {
      return this.db
        .insert(chat_run_step)
        .values(arg as Insertable<typeof chat_run_step>)
        .returning()
        .then((res) => res[0]!);
    }
  }

  public async selectChatRunStepByID(id: string) {
    return this.db
      .select()
      .from(chat_run_step_with_status)
      .where(eq(chat_run_step_with_status.id, id))
      .then((res) => res[0]);
  }

  public async selectChatSteps(
    params: CursorPaginated<{
      chat_id: string;
      run_id?: string;
    }>
  ) {
    let where: SQL | undefined = eq(
      chat_run_step_with_status.chat_id,
      params.chat_id
    );
    if (params.run_id) {
      where = and(
        where,
        eq(chat_run_step_with_status.chat_run_id, params.run_id)
      );
    }

    return withCursorPagination(
      this.db.select().from(chat_run_step_with_status).$dynamic(),
      {
        idColumn: chat_run_step_with_status.id,
        sortExpr: chat_run_step_with_status.started_at,
        direction: "desc",
        baseWhere: where,
        getKey: (row) => ({
          ts: row.started_at,
          id: row.id,
        }),
      },
      params
    );
  }

  public async updateChatRunStep(
    updates: Pick<ChatRunStep, "id"> & Partial<ChatRunStep>
  ) {
    return this.db
      .update(chat_run_step)
      .set(updates)
      .where(and(eq(chat_run_step.id, updates.id)))
      .returning()
      .then((res) => res[0]!);
  }

  public async selectChatRuns(
    params: CursorPaginated<{
      chatID: string;
    }>
  ) {
    return withCursorPagination(
      this.db.select().from(chat_run_with_status).$dynamic(),
      {
        idColumn: chat_run_with_status.id,
        sortExpr: chat_run_with_status.created_at,
        direction: "desc",
        baseWhere: eq(chat_run_with_status.chat_id, params.chatID),
        getKey: (row) => ({
          ts: row.created_at,
          id: row.id,
        }),
      },
      params
    );
  }

  public async selectChatRun(id: string) {
    return this.db
      .select()
      .from(chat_run_with_status)
      .where(eq(chat_run_with_status.id, id))
      .then((res) => res[0]);
  }

  public async selectAgentRun({
    agent_id,
    run_id,
  }: {
    agent_id: string;
    run_id: string;
  }) {
    return this.db
      .select()
      .from(chat_run_with_status)
      .where(
        and(
          eq(chat_run_with_status.id, run_id),
          eq(chat_run_with_status.agent_id, agent_id)
        )
      )
      .then((res) => res[0]);
  }

  public async selectAgentRuns(
    params: CursorPaginated<{
      agent_id: string;
      agent_deployment_id?: string;
      chat_ids?: string[];
    }>
  ) {
    let where: SQL | undefined = eq(
      chat_run_with_status.agent_id,
      params.agent_id
    );
    if (params.agent_deployment_id) {
      where = and(
        where,
        eq(chat_run_with_status.agent_deployment_id, params.agent_deployment_id)
      );
    }
    if (params.chat_ids) {
      where = and(
        where,
        inArray(chat_run_with_status.chat_id, params.chat_ids)
      );
    }

    return withCursorPagination(
      this.db.select().from(chat_run_with_status).$dynamic(),
      {
        idColumn: chat_run_with_status.id,
        sortExpr: chat_run_with_status.created_at,
        direction: "desc",
        baseWhere: where,
        getKey: (row) => ({
          ts: row.created_at,
          id: row.id,
        }),
      },
      params
    );
  }

  public async selectAgentStep({
    agent_id,
    step_id,
  }: {
    agent_id: string;
    step_id: string;
  }) {
    return this.db
      .select()
      .from(chat_run_step_with_status)
      .where(
        and(
          eq(chat_run_step_with_status.id, step_id),
          eq(chat_run_step_with_status.agent_id, agent_id)
        )
      )
      .then((res) => res[0]);
  }

  public async selectAgentSteps(
    params: CursorPaginated<{
      agent_id: string;
      agent_deployment_id?: string;
      chat_id?: string;
      chat_ids?: string[];
      run_id?: string;
      status?: ChatRunStepStatus;
    }>
  ) {
    let where: SQL | undefined = eq(
      chat_run_step_with_status.agent_id,
      params.agent_id
    );
    if (params.agent_deployment_id) {
      where = and(
        where,
        eq(
          chat_run_step_with_status.agent_deployment_id,
          params.agent_deployment_id
        )
      );
    }

    if (params.chat_id) {
      where = and(where, eq(chat_run_step_with_status.chat_id, params.chat_id));
    }

    if (params.chat_ids) {
      where = and(
        where,
        inArray(chat_run_step_with_status.chat_id, params.chat_ids)
      );
    }

    if (params.run_id) {
      where = and(
        where,
        eq(chat_run_step_with_status.chat_run_id, params.run_id)
      );
    }

    if (params.status) {
      where = and(where, eq(chat_run_step_with_status.status, params.status));
    }

    return withCursorPagination(
      this.db.select().from(chat_run_step_with_status).$dynamic(),
      {
        idColumn: chat_run_step_with_status.id,
        sortExpr: chat_run_step_with_status.started_at,
        direction: "desc",
        baseWhere: where,
        getKey: (row) => ({
          ts: row.started_at,
          id: row.id,
        }),
      },
      params
    );
  }

  public async selectAgentStorageKV({
    deployment_target_id,
    key,
  }: {
    deployment_target_id: string;
    key: string;
  }) {
    return this.db
      .select()
      .from(agent_storage_kv)
      .where(
        and(
          eq(agent_storage_kv.agent_deployment_target_id, deployment_target_id),
          eq(agent_storage_kv.key, key)
        )
      )
      .then((res) => res[0]);
  }

  public async selectAgentStorageKVByPrefix(
    args: CursorPaginated<{
      deployment_target_id: string;
      prefix: string;
    }>
  ) {
    const limitPlus = (args.limit ?? 10) + 1;
    const { deployment_target_id, prefix, cursor } = args;

    let cursorWhere: SQL | undefined;
    if (cursor) {
      const c = decodeCursor(cursor);
      cursorWhere = sql`(${agent_storage_kv.key} > ${c.id} OR (${agent_storage_kv.key} = ${c.id} AND ${agent_storage_kv.id} > ${c.ts.toISOString()}))`;
    }

    const finalWhere = and(
      eq(agent_storage_kv.agent_deployment_target_id, deployment_target_id),
      like(agent_storage_kv.key, sql`${prefix}%`),
      cursorWhere
    );

    const rows = await this.db
      .select()
      .from(agent_storage_kv)
      .where(finalWhere)
      .orderBy(asc(agent_storage_kv.key), asc(agent_storage_kv.id))
      .limit(limitPlus);

    const has_more = rows.length > (args.limit ?? 10);
    const items = has_more ? rows.slice(0, args.limit ?? 10) : rows;
    const last = items[items.length - 1];

    return {
      items,
      next_cursor:
        has_more && last ? encodeCursor(new Date(last.id), last.key) : null,
    };
  }

  public async upsertAgentStorageKV(args: Insertable<typeof agent_storage_kv>) {
    return this.db
      .insert(agent_storage_kv)
      .values(args)
      .onConflictDoUpdate({
        target: [
          agent_storage_kv.agent_deployment_target_id,
          agent_storage_kv.key,
        ],
        set: {
          value: args.value as string,
        },
      });
  }

  public async deleteAgentStorageKV(args: {
    key: string;
    deployment_target_id: string;
  }) {
    return this.db
      .delete(agent_storage_kv)
      .where(
        and(
          eq(
            agent_storage_kv.agent_deployment_target_id,
            args.deployment_target_id
          ),
          eq(agent_storage_kv.key, args.key)
        )
      );
  }

  public async upsertChatForAgentDeploymentTarget(
    args: Insertable<typeof chat>
  ): Promise<{ id: string; created_at: Date; created: boolean }> {
    const result = await this.db
      .insert(chat)
      .values(args)
      .onConflictDoNothing({
        target: [chat.agent_deployment_target_id, chat.agent_key],
      })
      .returning({ id: chat.id, created_at: chat.created_at });

    if (result.length > 0) {
      // Chat was created
      return {
        id: result[0]!.id,
        created_at: result[0]!.created_at,
        created: true,
      };
    }

    // Chat already exists, fetch it
    const existing = await this.db
      .select({ id: chat.id, created_at: chat.created_at })
      .from(chat)
      .where(
        and(
          eq(chat.agent_deployment_target_id, args.agent_deployment_target_id!),
          eq(chat.agent_key, args.agent_key!)
        )
      )
      .limit(1);

    if (!existing[0]) {
      throw new Error("Failed to upsert chat");
    }

    return {
      id: existing[0].id,
      created_at: existing[0].created_at,
      created: false,
    };
  }

  public async selectChatByAgentKey({
    agentID,
    key,
  }: {
    agentID: string;
    key: string;
  }) {
    return this.db
      .select()
      .from(chat)
      .where(and(eq(chat.agent_id, agentID), eq(chat.agent_key, key)))
      .then((res) => res[0]);
  }

  /**
   * If there's already a running step for this chat,
   * this does nothing.
   *
   * If there's no running step, it creates one.
   *
   * If there's a running step and behavior=interrupt, it interrupts it.
   *
   * If there's a running step and behavior=enqueue, it does nothing.
   */
  public async reconcileChatRun(req: {
    behavior: "interrupt" | "enqueue";
    chat_id: string;
    agent_id: string;
    agent_deployment_id?: string;
  }): Promise<void> {
    await this.tx(async (tx) => {
      // behavior=interrupt -> immediately mark current open step interrupted
      if (req.behavior === "interrupt") {
        await tx.db.execute(sql`
          UPDATE chat_run_step
             SET interrupted_at = NOW()
           WHERE chat_id = ${req.chat_id}
             AND completed_at IS NULL
             AND interrupted_at IS NULL
             AND error IS NULL
        `);
      }

      // This is defensive. If there are stalled steps (e.g. the worker just exploded),
      // we don't want to block a chat.
      await tx.db.execute(sql`
        UPDATE chat_run_step
           SET
              error = COALESCE(error, 'The chat stalled for an unknown reason. Please contact support.')
         WHERE chat_id = ${req.chat_id}
           AND completed_at IS NULL
           AND interrupted_at IS NULL
           AND error IS NULL
           AND heartbeat_at < NOW() - ${ChatRunStepStalledDurationSQL}
      `);
    });

    try {
      await this.tx(async (tx) => {
        // Prefer explicit deployment, else chat's, else agent's active
        let deploymentId = req.agent_deployment_id;
        if (!deploymentId) {
          // Select the active deployment for the agent.
          const deployment = await tx.selectAgentDeploymentByIDOrActive({
            agentID: req.agent_id,
          });
          if (!deployment) {
            throw new Error("No active deployment for agent");
          }
          deploymentId = deployment.id;
        }

        // Insert run and its first step atomically.
        // If step insert violates uniq_open_step_per_chat,
        // the whole tx aborts, leaving no stray run.
        const run = await tx.db
          .insert(chat_run)
          .values({
            chat_id: req.chat_id,
            agent_id: req.agent_id,
            agent_deployment_id: deploymentId,
          } as Insertable<typeof chat_run>)
          .returning()
          .then((res) => res[0]);
        if (!run) {
          throw new Error("Failed to insert chat run");
        }

        // If there was already an open step, this insert hits 23505
        // on chat_run_step_single_streaming and the tx is rolled back.
        await tx.insertChatRunStep({
          chat_id: req.chat_id,
          chat_run_id: run.id,
          agent_id: req.agent_id,
          agent_deployment_id: deploymentId,
        });
      });
    } catch (err) {
      if (isUniqueChatRunStepConstraintError(err)) {
        // There's already a running step for this chat.
        // This is expected and totally fine - we don't need to do anything.
        return;
      }

      throw err;
    }
  }

  // Agent Permissions

  /**
   * Get the effective permission level for a user on an agent.
   * Resolution order:
   * 1. User-specific permission (if exists)
   * 2. Organization-level default (user_id = NULL)
   * 3. Fallback based on org role (owner/admin -> write, others -> read)
   */
  public async getAgentPermissionForUser(params: {
    agentId: string;
    userId: string;
    orgRole?: "owner" | "admin" | "member" | "billing_admin";
    agentVisibility?: "private" | "public" | "organization";
  }): Promise<AgentPermissionLevel | undefined> {
    // Get agent visibility if not provided
    let visibility = params.agentVisibility;
    if (!visibility) {
      const agent = await this.selectAgentByID(params.agentId);
      if (!agent) {
        throw new Error(`Agent ${params.agentId} not found`);
      }
      visibility = agent.visibility;
    }

    // For organization visibility: all org members can access
    if (visibility === "organization") {
      // Check for user-specific permission first (for elevated access)
      const userPermission = await this.db
        .select()
        .from(agent_permission)
        .where(
          and(
            eq(agent_permission.agent_id, params.agentId),
            eq(agent_permission.user_id, params.userId)
          )
        )
        .then((res) => res[0]);

      if (userPermission) {
        return userPermission.permission;
      }

      // Check for org-level default permission
      const orgPermission = await this.db
        .select()
        .from(agent_permission)
        .where(
          and(
            eq(agent_permission.agent_id, params.agentId),
            isNull(agent_permission.user_id)
          )
        )
        .then((res) => res[0]);

      if (orgPermission) {
        return orgPermission.permission;
      }

      // Org owners and admins always have admin by default
      if (params.orgRole === "owner" || params.orgRole === "admin") {
        return "admin";
      }

      // All other org members get read by default for organization visibility
      return "read";
    }

    // For private visibility: only org admins/owners or explicitly granted users can access
    if (visibility === "private") {
      // Org owners and admins bypass permission checks
      if (params.orgRole === "owner" || params.orgRole === "admin") {
        return "admin";
      }

      // Check for user-specific permission
      const userPermission = await this.db
        .select()
        .from(agent_permission)
        .where(
          and(
            eq(agent_permission.agent_id, params.agentId),
            eq(agent_permission.user_id, params.userId)
          )
        )
        .then((res) => res[0]);

      if (userPermission) {
        return userPermission.permission;
      }

      // Check for org-level default permission
      const orgPermission = await this.db
        .select()
        .from(agent_permission)
        .where(
          and(
            eq(agent_permission.agent_id, params.agentId),
            isNull(agent_permission.user_id)
          )
        )
        .then((res) => res[0]);

      if (orgPermission) {
        return orgPermission.permission;
      }

      // No access for private agents without explicit permission
      return undefined;
    }

    // For public visibility: all org members can access
    // (This is similar to organization visibility for now)
    // Check for user-specific permission first (for elevated access)
    const userPermission = await this.db
      .select()
      .from(agent_permission)
      .where(
        and(
          eq(agent_permission.agent_id, params.agentId),
          eq(agent_permission.user_id, params.userId)
        )
      )
      .then((res) => res[0]);

    if (userPermission) {
      return userPermission.permission;
    }

    // Check for org-level default permission
    const orgPermission = await this.db
      .select()
      .from(agent_permission)
      .where(
        and(
          eq(agent_permission.agent_id, params.agentId),
          isNull(agent_permission.user_id)
        )
      )
      .then((res) => res[0]);

    if (orgPermission) {
      return orgPermission.permission;
    }

    // Fallback to org role
    // Org owners and admins always have admin by default
    if (params.orgRole === "owner" || params.orgRole === "admin") {
      return "admin";
    }

    // Members and billing admins get read by default
    return "read";
  }

  /**
   * Get all permissions for an agent (both user-specific and org default)
   */
  public async selectAgentPermissions(
    params: Paginated<{
      agentId: string;
      orderBy?: "permission" | "name" | "created_at";
      orderDirection?: "asc" | "desc";
    }>
  ) {
    const direction = params.orderDirection ?? "asc";
    const isDesc = direction === "desc";

    // Determine order by clause
    let orderByClause;
    switch (params.orderBy) {
      case "permission":
        // Permission hierarchy: admin=1, write=2, read=3 for asc (highest first)
        // Reverse for desc
        orderByClause = isDesc
          ? sql`CASE 
              WHEN ${agent_permission.permission} = 'read' THEN 1 
              WHEN ${agent_permission.permission} = 'write' THEN 2 
              WHEN ${agent_permission.permission} = 'admin' THEN 3 
            END, ${user_with_personal_organization.display_name} DESC NULLS LAST, ${user_with_personal_organization.username} DESC NULLS LAST`
          : sql`CASE 
              WHEN ${agent_permission.permission} = 'admin' THEN 1 
              WHEN ${agent_permission.permission} = 'write' THEN 2 
              WHEN ${agent_permission.permission} = 'read' THEN 3 
            END, ${user_with_personal_organization.display_name} ASC NULLS LAST, ${user_with_personal_organization.username} ASC NULLS LAST`;
        break;
      case "name":
        orderByClause = isDesc
          ? sql`${user_with_personal_organization.display_name} DESC NULLS LAST, ${user_with_personal_organization.username} DESC NULLS LAST`
          : sql`${user_with_personal_organization.display_name} ASC NULLS LAST, ${user_with_personal_organization.username} ASC NULLS LAST`;
        break;
      case "created_at":
        orderByClause = isDesc
          ? sql`${agent_permission.created_at} DESC`
          : sql`${agent_permission.created_at} ASC`;
        break;
      default:
        orderByClause = sql`${agent_permission.created_at} DESC`;
        break;
    }

    return withPagination(
      this.db
        .select({
          ...getTableColumns(agent_permission),
          user: {
            id: user_with_personal_organization.id,
            created_at: user_with_personal_organization.created_at,
            updated_at: user_with_personal_organization.updated_at,
            username: user_with_personal_organization.username,
            display_name: user_with_personal_organization.display_name,
            email: user_with_personal_organization.email,
            avatar_url: user_with_personal_organization.avatar_url,
          },
        })
        .from(agent_permission)
        .leftJoin(
          user_with_personal_organization,
          eq(agent_permission.user_id, user_with_personal_organization.id)
        )
        .where(eq(agent_permission.agent_id, params.agentId))
        .$dynamic(),
      orderByClause,
      params
    );
  }

  /**
   * Grant or update a permission for a user or org
   */
  public async upsertAgentPermission(params: {
    agent_id: string;
    user_id?: string;
    permission: AgentPermissionLevel;
    created_by: string;
  }): Promise<AgentPermission> {
    const [permission] = await this.db
      .insert(agent_permission)
      .values({
        agent_id: params.agent_id,
        user_id: params.user_id ?? null,
        permission: params.permission,
        created_by: params.created_by,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [agent_permission.agent_id, agent_permission.user_id],
        set: {
          permission: params.permission,
          updated_at: new Date(),
        },
      })
      .returning();
    return permission!;
  }

  /**
   * Delete a specific permission
   */
  public async deleteAgentPermission(params: {
    agent_id: string;
    user_id?: string;
  }): Promise<void> {
    await this.db
      .delete(agent_permission)
      .where(
        and(
          eq(agent_permission.agent_id, params.agent_id),
          params.user_id
            ? eq(agent_permission.user_id, params.user_id)
            : isNull(agent_permission.user_id)
        )
      );
  }

  /**
   * Delete expired chats based on their expire_ttl and created_at.
   * Returns the number of chats deleted.
   */
  public async deleteExpiredChats(params?: {
    limit?: number;
    now?: Date;
  }): Promise<number> {
    const now = params?.now ?? new Date();
    const limit = params?.limit ?? 100;

    // Use a CTE to find expired chats, then delete them in one query
    // This is much more efficient than fetching + filtering + deleting
    const result = await this.db.execute(sql`
      WITH expired_chats AS (
        SELECT id
        FROM ${chat_with_status}
        WHERE ${chat_with_status.expire_ttl} IS NOT NULL
          AND ${chat_with_status.expires_at} <= ${now}
        LIMIT ${limit}
      )
      DELETE FROM ${chat}
      WHERE id IN (SELECT id FROM expired_chats)
      RETURNING id
    `);

    return result.rowCount ?? 0;
  }

  public tx<T>(fn: (tx: Querier) => Promise<T>) {
    if (this.inTx) {
      throw new Error(
        "Do not nest transactions! Prefer passing the database so it's easier to debug."
      );
    }
    return this.db.transaction(async (tx) => {
      const txQuerier = new Querier(tx);
      txQuerier.inTx = true;
      return await fn(txQuerier);
    });
  }

  public async insertUsageEvent(
    event: Insertable<typeof organization_billing_usage_event>
  ) {
    return await this.db
      .insert(organization_billing_usage_event)
      .values(event)
      .returning();
  }

  public async updateUsageEvent(
    updates: Pick<OrganizationBillingUsageEvent, "id"> &
      Partial<OrganizationBillingUsageEvent>
  ) {
    return await this.db
      .update(organization_billing_usage_event)
      .set(updates)
      .where(eq(organization_billing_usage_event.id, updates.id))
      .returning()
      .then((rows) => rows[0]!);
  }

  // Observability: Logs
  async getAgentLogs(opts: {
    agent_id: string;
    message_pattern?: string;
    filters?: FieldFilterGroup;
    start_time: Date;
    end_time: Date;
    limit: number;
  }): Promise<ObservabilityAgentLog[]> {
    return getAgentLogsImpl(this.db, opts);
  }

  async writeAgentLog(opts: {
    agent_id: string;
    event: Record<string, unknown>;
  }): Promise<void> {
    return writeAgentLogImpl(this.db, opts);
  }

  // Observability: Traces
  async writeAgentTraces(spans: OtelSpan[]): Promise<void> {
    return writeTraces(this.db, spans);
  }

  async readAgentTraces(
    opts: ReadTracesOpts
  ): Promise<(OtelSpan & { created_at: string })[]> {
    return readTraces(this.db, opts);
  }
}

export type Paginated<T = {}> = T & {
  page?: number;
  per_page?: number;
};

const withPagination = async <T extends PgSelect>(
  qb: T,
  orderByColumn: PgColumn | SQL | SQL.Aliased,
  { page = 1, per_page = 10 }: Paginated
): Promise<{
  items: Awaited<T>[number][];
  has_more: boolean;
}> => {
  const limit = per_page + 1;
  const query = qb
    .orderBy(orderByColumn)
    .limit(limit)
    .offset((page - 1) * per_page);

  const items = await query;
  const hasMore = items.length > per_page;

  return {
    items: items.slice(0, per_page),
    has_more: hasMore,
  };
};

export type CursorPaginated<T = {}> = T & {
  limit?: number;
  cursor?: string;
};

async function withCursorPagination<
  T extends PgSelect,
  Row = Awaited<T>[number],
>(
  qb: T,
  opts: {
    sortExpr: PgColumn | SQL | SQL.Aliased; // e.g. chat.created_at
    idColumn: PgColumn; // e.g. chat.id
    direction: "asc" | "desc"; // overall order
    baseWhere?: SQL; // filters to AND with cursor
    getKey: (row: Row) => { ts: Date; id: string };
  },
  { limit = 10, cursor }: CursorPaginated
): Promise<{
  items: Row[];
  next_cursor: string | null;
}> {
  const limitPlus = limit + 1;
  const { sortExpr, idColumn, direction, baseWhere, getKey } = opts;

  let cursorWhere: SQL | undefined;
  if (cursor) {
    const c = decodeCursor(cursor); // { ts: Date, id: string }
    const ts = c.ts.toISOString();
    cursorWhere =
      direction === "desc"
        ? sql`(${sortExpr} < ${ts} OR (${sortExpr} = ${ts} AND ${idColumn} < ${c.id}))`
        : sql`(${sortExpr} > ${ts} OR (${sortExpr} = ${ts} AND ${idColumn} > ${c.id}))`;
  }

  const finalWhere = baseWhere
    ? cursorWhere
      ? and(baseWhere, cursorWhere)
      : baseWhere
    : cursorWhere;

  let q: any = qb;
  if (finalWhere) q = q.where(finalWhere);

  const rows: Row[] = await q
    .orderBy(
      direction === "desc" ? desc(sortExpr) : asc(sortExpr),
      direction === "desc" ? desc(idColumn) : asc(idColumn)
    )
    .limit(limitPlus);

  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const out: {
    items: Row[];
    next_cursor: string | null;
  } = { next_cursor: null, items };
  if (has_more && last) {
    const k = getKey(last);
    out.next_cursor = encodeCursor(k.ts, k.id);
  }
  return out;
}

export type Insertable<
  T extends PgTable,
  K extends keyof PgInsertValue<T> = never,
> = {
  [P in keyof PgInsertValue<T> as P extends K ? never : P]: PgInsertValue<T>[P];
} & {
  [P in keyof PgInsertValue<T> as P extends K ? P : never]?:
    | PgInsertValue<T>[P]
    | undefined;
};

// Base64url helpers (Node)
const b64u = {
  enc: (b: Uint8Array) =>
    Buffer.from(b)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, ""),
  dec: (s: string): Uint8Array =>
    new Uint8Array(
      Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    ),
};

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 6-byte ms timestamp + 16-byte UUID = 22 bytes -> ~30 chars base64url
function encodeCursor(ts: Date, id: string): string {
  const ms = ts.getTime(); // number, safe (<= 2^53-1)
  const buf = new Uint8Array(22);
  let x = ms;
  for (let i = 5; i >= 0; i--) {
    buf[i] = x % 256;
    x = Math.floor(x / 256);
  }
  buf.set(uuidToBytes(id), 6); // no .copy; Uint8Array#set works
  return b64u.enc(buf);
}

function decodeCursor(s: string): { ts: Date; id: string } {
  const buf = b64u.dec(s);
  let ms = 0;
  for (let i = 0; i < 6; i++) ms = ms * 256 + buf[i]!;
  const id = bytesToUuid(buf.subarray(6, 22));
  return { ts: new Date(ms), id };
}

function parseDbTimestamp(value: Date | string): Date {
  if (value instanceof Date) return value;
  if (/[zZ]|[+\-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  return new Date(value + "Z");
}

export function isUniqueChatRunStepConstraintError(err: unknown): boolean {
  if (
    err instanceof DrizzleQueryError &&
    err.cause instanceof postgres.PostgresError &&
    err.cause.code === "23505" &&
    (err.cause.constraint_name === "chat_run_step_chat_id_idx" ||
      err.cause.constraint_name === "chat_run_step_single_streaming")
  ) {
    return true;
  }
  return false;
}

function generateUsername(options: {
  displayName?: string;
  email?: string;
  suffix?: string; // For uniqueness, e.g., '1', '2'
}): string {
  let input = (options.displayName || options.email || "").trim();
  if (!input) {
    input = "user";
  }

  // For email, use local part only
  if (options.email && !options.displayName) {
    input = input.split("@")[0]!;
  }

  // Clean: lowercase, keep only a-z0-9-, collapse multiple -, remove leading/trailing -
  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  // Fallback if empty
  if (!slug) {
    slug = "user";
  }

  // Ensure starts with a-z0-9 (prepend 'u' if needed)
  if (!/^[a-z0-9]/.test(slug)) {
    slug = "u" + slug;
  }

  // Append suffix if provided (e.g., for uniqueness)
  if (options.suffix) {
    slug += `-${options.suffix}`;
  }

  // Truncate to max 39 chars, then strip any trailing -
  const orgName = slug.slice(0, 39).replace(/-+$/, "");

  // Final fallback if empty after processing
  return orgName || "user";
}
