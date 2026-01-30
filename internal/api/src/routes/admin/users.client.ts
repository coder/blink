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
});

export type SiteUser = z.infer<typeof schemaSiteUser>;

export const schemaListSiteUsersRequest = schemaPaginatedRequest.extend({
  query: z.string().optional(),
  site_role: schemaSiteRole.optional(),
});

export type ListSiteUsersRequest = z.infer<typeof schemaListSiteUsersRequest>;

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
}
