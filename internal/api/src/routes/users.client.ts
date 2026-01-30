import z from "zod";
import {
  assertResponseStatus,
  nameFormat,
  schemaPaginatedRequest,
} from "../client-helper";
import Client from "../client.browser";

export const schemaUser = z.object({
  id: z.uuid(),
  created_at: z.date(),
  updated_at: z.date(),
  email: z.string().email(),
  email_verified: z.boolean(),
  display_name: z.string(),
  username: z.string(),
  organization_id: z.uuid(),
  avatar_url: z.string().url().nullable(),
  site_role: z.enum(["admin", "member"]),
});

export type User = z.infer<typeof schemaUser>;

export const schemaUpdateUserRequest = z.object({
  display_name: z.string().max(100).optional(),
  username: z.string().regex(nameFormat).optional(),
  avatar_file_id: z.string().nullable().optional(),
});

export type UpdateUserRequest = z.infer<typeof schemaUpdateUserRequest>;

export const schemaUserAccount = z.object({
  provider: z.enum(["github", "google"]),
  provider_account_id: z.string(),
});

export type UserAccount = z.infer<typeof schemaUserAccount>;

export const schemaUserAccounts = z.object({
  github: z.array(schemaUserAccount),
  google: z.array(schemaUserAccount),
});

export type UserAccounts = z.infer<typeof schemaUserAccounts>;

export const schemaApiKey = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string().nullable(),
  key_lookup: z.string(),
  key_prefix: z.string(),
  key_suffix: z.string(),
  scope: z.enum(["full"]),
  expires_at: z.coerce.date().nullable(),
  last_used_at: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  revoked_at: z.coerce.date().nullable(),
  revoked_by: z.uuid().nullable(),
});

export type ApiKey = z.infer<typeof schemaApiKey>;

export const schemaListApiKeysRequest = schemaPaginatedRequest;
export type ListApiKeysRequest = z.infer<typeof schemaListApiKeysRequest>;

export const schemaListApiKeysResponse = z.object({
  items: z.array(schemaApiKey),
});
export type ListApiKeysResponse = z.infer<typeof schemaListApiKeysResponse>;

export const schemaCreateApiKeyRequest = z.object({
  name: z.string().optional(),
  scope: z.enum(["full"]).optional(),
  expires_at: z.coerce.date().optional(),
});

export const schemaCreateApiKeyResponse = schemaApiKey.extend({
  key: z.string(),
});
export type CreateApiKeyResponse = z.infer<typeof schemaCreateApiKeyResponse>;

export type CreateApiKeyRequest = z.infer<typeof schemaCreateApiKeyRequest>;

export const schemaRevokeApiKeyRequest = z.object({
  key_id: z.uuid(),
});

export type RevokeApiKeyRequest = z.infer<typeof schemaRevokeApiKeyRequest>;

export default class Users {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Get the current user.
   *
   * @returns The current user.
   */
  public async me(): Promise<User> {
    return this.get("me");
  }

  /**
   * Get a user by ID.
   *
   * @param id - The ID of the user.
   * @returns The user.
   */
  public async get(id: string): Promise<User> {
    const res = await this.client.request("GET", `/api/users/${id}`);
    await assertResponseStatus(res, 200);
    return res.json();
  }

  /**
   * Update the current user.
   *
   * @param request - The update request.
   * @returns The updated user.
   */
  public async update(request: UpdateUserRequest): Promise<User> {
    const res = await this.client.request(
      "PATCH",
      "/api/users/me",
      JSON.stringify(request)
    );
    await assertResponseStatus(res, 200);
    return res.json();
  }

  /**
   * Get user accounts (OAuth providers) for the current user.
   *
   * @returns The user accounts.
   */
  public async accounts(): Promise<UserAccounts> {
    const res = await this.client.request("GET", "/api/users/me/accounts");
    await assertResponseStatus(res, 200);
    return res.json();
  }

  /**
   * Unlink an OAuth provider for the current user.
   *
   * @param provider - The provider to unlink.
   * @param providerAccountId - The provider account ID.
   */
  public async unlinkProvider(
    provider: "github" | "google",
    providerAccountId: string
  ): Promise<void> {
    const res = await this.client.request(
      "DELETE",
      `/api/users/me/accounts/${provider}/${providerAccountId}`
    );
    await assertResponseStatus(res, 204);
  }

  /**
   * Delete the current user account.
   */
  public async delete(): Promise<void> {
    const res = await this.client.request("DELETE", "/api/users/me");
    await assertResponseStatus(res, 204);
  }

  public async listApiKeys(
    request: ListApiKeysRequest = {}
  ): Promise<ListApiKeysResponse> {
    const response = await this.client.request("GET", "/api/users/me/api-keys");
    await assertResponseStatus(response, 200);
    return response.json();
  }

  public async createApiKey(
    request: CreateApiKeyRequest = {}
  ): Promise<CreateApiKeyResponse> {
    const response = await this.client.request(
      "POST",
      "/api/users/me/api-keys",
      JSON.stringify(request)
    );
    await assertResponseStatus(response, 200);
    return response.json();
  }

  public async revokeApiKey(request: RevokeApiKeyRequest): Promise<void> {
    const response = await this.client.request(
      "DELETE",
      `/api/users/me/api-keys/${request.key_id}`
    );
    await assertResponseStatus(response, 204);
  }
}
