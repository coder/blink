import { z } from "zod";
import type Client from "../../client.browser";
import {
  assertResponseStatus,
  schemaPaginatedRequest,
  schemaPaginatedResponse,
} from "../../client-helper";

export const schemaSiteRole = z.enum(["admin", "member"]);

export type SiteRole = z.infer<typeof schemaSiteRole>;

const schemaSiteUser = z.object({
  id: z.uuid(),
  created_at: z.date(),
  updated_at: z.date(),
  display_name: z.string().nullable(),
  email: z.email(),
  avatar_url: z.url().nullable(),
  username: z.string(),
  organization_id: z.uuid(),
  site_role: schemaSiteRole,
  suspended: z.boolean(),
});

export type SiteUser = z.infer<typeof schemaSiteUser>;

export const schemaListSiteUsersRequest = schemaPaginatedRequest.extend({
  query: z.string().optional(),
  site_role: schemaSiteRole.optional(),
});

export type ListSiteUsersRequest = z.infer<typeof schemaListSiteUsersRequest>;

export const schemaUpdateSuspensionRequest = z.object({
  suspended: z.boolean(),
});

export type UpdateSuspensionRequest = z.infer<
  typeof schemaUpdateSuspensionRequest
>;

const schemaListSiteUsersResponse = schemaPaginatedResponse(schemaSiteUser);

export type ListSiteUsersResponse = z.infer<typeof schemaListSiteUsersResponse>;

export default class AdminUsers {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List all users in the site (admin only).
   *
   * @param request - The request body.
   * @returns The list of users.
   */
  public async list(
    request: ListSiteUsersRequest = {}
  ): Promise<ListSiteUsersResponse> {
    const query = new URLSearchParams();
    if (request.per_page) {
      query.set("per_page", request.per_page.toString());
    }
    if (request.page) {
      query.set("page", request.page.toString());
    }
    if (request.query) {
      query.set("query", request.query);
    }
    if (request.site_role) {
      query.set("site_role", request.site_role);
    }
    const resp = await this.client.request(
      "GET",
      `/api/admin/users?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Update a user's suspension status (admin only).
   *
   * @param userId - The user ID to update.
   * @param suspended - Whether the user should be suspended.
   * @returns The updated user.
   */
  public async updateSuspension(
    userId: string,
    suspended: boolean
  ): Promise<SiteUser> {
    const resp = await this.client.request(
      "PATCH",
      `/api/admin/users/${userId}/suspension`,
      JSON.stringify({ suspended })
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
