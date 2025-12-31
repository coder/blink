import { z } from "zod";
import {
  assertResponseStatus,
  schemaPaginatedRequest,
  schemaPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";

export const schemaOrganizationRole = z.enum([
  "owner",
  "admin",
  "billing_admin",
  "member",
]);

export const schemaOrganizationMembership = z.object({
  user_id: z.uuid(),
  organization_id: z.uuid(),
  role: schemaOrganizationRole,
  created_at: z.date(),
  updated_at: z.date(),
});

export type OrganizationMembership = z.infer<
  typeof schemaOrganizationMembership
>;

const schemaOrganizationUser = z.object({
  id: z.uuid(),
  created_at: z.date(),
  updated_at: z.date(),
  display_name: z.string().nullable(),
  email: z.email(),
  avatar_url: z.url().nullable(),
  username: z.string(),
  organization_id: z.uuid(),
});

const schemaOrganizationMember = schemaOrganizationMembership.extend({
  user: schemaOrganizationUser,
});

export type OrganizationMember = z.infer<typeof schemaOrganizationMember>;

const schemaListOrganizationMembersRequest = schemaPaginatedRequest.extend({
  organization_id: z.uuid(),
  query: z.string().optional(),
  order_by: z.enum(["role", "name", "created_at"]).optional(),
});

export type ListOrganizationMembersRequest = z.infer<
  typeof schemaListOrganizationMembersRequest
>;

const schemaListOrganizationMembersResponse = schemaPaginatedResponse(
  schemaOrganizationMember
);

export type ListOrganizationMembersResponse = z.infer<
  typeof schemaListOrganizationMembersResponse
>;

const schemaDeleteOrganizationMemberRequest = z.object({
  organization_id: z.uuid(),
  user_id: z.uuid(),
});

export type DeleteOrganizationMemberRequest = z.infer<
  typeof schemaDeleteOrganizationMemberRequest
>;

export const schemaUpdateOrganizationMemberRequestBody = z.object({
  role: z.enum(["owner", "admin", "member", "billing_admin"]).optional(),
});

const schemaUpdateOrganizationMemberRequest =
  schemaUpdateOrganizationMemberRequestBody.extend({
    organization_id: z.uuid(),
    user_id: z.uuid(),
  });

export type UpdateOrganizationMemberRequest = z.infer<
  typeof schemaUpdateOrganizationMemberRequest
>;

export interface GetOrganizationMemberRequest {
  organization_id: string;
  user_id: string;
}

export default class OrganizationMembers {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List members of an organization.
   *
   * @param request - The request body.
   * @returns The list of members.
   */
  public async list(
    request: ListOrganizationMembersRequest
  ): Promise<ListOrganizationMembersResponse> {
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
    if (request.order_by) {
      query.set("order_by", request.order_by);
    }
    const resp = await this.client.request(
      "GET",
      `/api/organizations/${request.organization_id}/members?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  public async get(
    request: GetOrganizationMemberRequest
  ): Promise<OrganizationMember> {
    const resp = await this.client.request(
      "GET",
      `/api/organizations/${request.organization_id}/members/${request.user_id}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  public async delete(request: DeleteOrganizationMemberRequest): Promise<void> {
    const resp = await this.client.request(
      "DELETE",
      `/api/organizations/${request.organization_id}/members/${request.user_id}`
    );
    await assertResponseStatus(resp, 204);
  }

  public async update(
    request: UpdateOrganizationMemberRequest
  ): Promise<OrganizationMember> {
    const resp = await this.client.request(
      "PUT",
      `/api/organizations/${request.organization_id}/members/${request.user_id}`,
      JSON.stringify({ role: request.role } as z.infer<
        typeof schemaUpdateOrganizationMemberRequestBody
      >)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
