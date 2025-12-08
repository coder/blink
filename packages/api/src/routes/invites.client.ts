import { z } from "zod";
import { assertResponseStatus } from "../client-helper";
import Client from "../client.browser";
import {
  schemaOrganizationRole,
  type OrganizationMembership,
} from "./organizations/members.client";

export const schemaOrganizationInvite = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  role: schemaOrganizationRole,
  invited_by: z.uuid(),
  expires_at: z.date(),
  created_at: z.date(),
  updated_at: z.date(),
  reusable: z.boolean(),
  accepted_at: z.date().nullable(),
  email: z.string().email().nullable(),
});

export type OrganizationInvite = z.infer<typeof schemaOrganizationInvite>;

export type OrganizationInviteWithCode = OrganizationInvite & {
  code: string;
};

export const schemaCreateOrganizationInviteRequest = z.object({
  organization_id: z.uuid(),
  role: schemaOrganizationRole,
  email: z.string().email().optional(),
  reusable: z.boolean().optional(),
});

export type CreateOrganizationInviteRequest = z.infer<
  typeof schemaCreateOrganizationInviteRequest
>;

export const schemaListOrganizationInvitesRequest = z.object({
  organization_id: z.uuid(),
});

export type ListOrganizationInvitesRequest = z.infer<
  typeof schemaListOrganizationInvitesRequest
>;

export const schemaDeleteOrganizationInviteRequest = z.object({
  organization_id: z.uuid(),
  invite_id: z.uuid(),
});

export type DeleteOrganizationInviteRequest = z.infer<
  typeof schemaDeleteOrganizationInviteRequest
>;

export const schemaAcceptOrganizationInviteRequestBody = z.object({
  code: z.string(),
});

export const schemaAcceptOrganizationInviteRequest =
  schemaAcceptOrganizationInviteRequestBody.extend({
    invite_id: z.uuid(),
  });

export type AcceptOrganizationInviteRequest = z.infer<
  typeof schemaAcceptOrganizationInviteRequest
>;

export default class Invites {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Invite a user to an organization.
   *
   * @param request - The request body.
   * @returns The created invite.
   */
  public async create(
    request: CreateOrganizationInviteRequest
  ): Promise<OrganizationInviteWithCode> {
    const resp = await this.client.request(
      "POST",
      `/api/invites`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 201);
    return resp.json();
  }

  /**
   * List invites for an organization.
   *
   * @param request - The request body.
   * @returns The list of invites with codes.
   */
  public async list(
    request: ListOrganizationInvitesRequest
  ): Promise<OrganizationInviteWithCode[]> {
    const resp = await this.client.request(
      "GET",
      `/api/invites?organization_id=${request.organization_id}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete an invite for an organization.
   *
   * @param request - The request body.
   * @returns The deleted invite.
   */
  public async delete(request: DeleteOrganizationInviteRequest): Promise<void> {
    const resp = await this.client.request(
      "DELETE",
      `/api/invites/${request.invite_id}`
    );
    await assertResponseStatus(resp, 204);
  }

  /**
   * Accept an invite for the current authenticated user.
   */
  public async accept(
    request: AcceptOrganizationInviteRequest
  ): Promise<OrganizationMembership> {
    const resp = await this.client.request(
      "POST",
      `/api/invites/${request.invite_id}/accept`,
      JSON.stringify({ code: request.code } as z.infer<
        typeof schemaAcceptOrganizationInviteRequestBody
      >)
    );
    await assertResponseStatus(resp, 201);
    return resp.json();
  }
}
