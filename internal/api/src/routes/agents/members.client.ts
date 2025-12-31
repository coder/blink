import { z } from "zod";
import {
  assertResponseStatus,
  schemaOrderBy,
  schemaPaginatedRequest,
  schemaPaginatedResponse,
} from "../../client-helper";
import Client from "../../client.browser";

export const schemaAgentPermissionLevel = z.enum(["read", "write", "admin"]);

export const schemaAgentPermission = z.object({
  user_id: z.uuid().nullable(),
  agent_id: z.uuid(),
  permission: schemaAgentPermissionLevel,
  created_at: z.date(),
  updated_at: z.date(),
  created_by: z.uuid(),
});

export type AgentPermission = z.infer<typeof schemaAgentPermission>;

export const schemaAgentUser = z.object({
  id: z.uuid(),
  created_at: z.date(),
  updated_at: z.date(),
  display_name: z.string().nullable(),
  email: z.email(),
  avatar_url: z.url().nullable(),
  username: z.string(),
});

export const schemaAgentMember = schemaAgentPermission.extend({
  user: schemaAgentUser.nullable(),
});

export type AgentMember = z.infer<typeof schemaAgentMember>;

const agentMemberOrderFields = ["permission", "name", "created_at"] as const;

export const schemaListAgentMembersRequest = schemaPaginatedRequest.extend({
  agent_id: z.uuid(),
  order_by: schemaOrderBy(agentMemberOrderFields).optional(),
});

export type ListAgentMembersRequest = z.infer<
  typeof schemaListAgentMembersRequest
>;

export const schemaListAgentMembersResponse =
  schemaPaginatedResponse(schemaAgentMember);

export type ListAgentMembersResponse = z.infer<
  typeof schemaListAgentMembersResponse
>;

export const schemaGrantAgentPermissionRequestBody = z.object({
  user_id: z.uuid().nullable(),
  permission: schemaAgentPermissionLevel,
});

export const schemaGrantAgentPermissionRequest =
  schemaGrantAgentPermissionRequestBody.extend({
    agent_id: z.uuid(),
  });

export type GrantAgentPermissionRequest = z.infer<
  typeof schemaGrantAgentPermissionRequest
>;

export const schemaRevokeAgentPermissionRequest = z.object({
  agent_id: z.uuid(),
  user_id: z.uuid().nullable(),
});

export type RevokeAgentPermissionRequest = z.infer<
  typeof schemaRevokeAgentPermissionRequest
>;

export default class AgentMembers {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * List members with permissions for an agent.
   *
   * @param request - The request body.
   * @returns The list of members.
   */
  public async list(
    request: ListAgentMembersRequest
  ): Promise<ListAgentMembersResponse> {
    const query = new URLSearchParams();
    if (request.per_page) {
      query.set("per_page", request.per_page.toString());
    }
    if (request.page) {
      query.set("page", request.page.toString());
    }
    if (request.order_by) {
      query.set("order_by", request.order_by);
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/members?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Grant or update permission for a user (or org default if user_id is null).
   *
   * @param request - The request body.
   * @returns The updated permission.
   */
  public async grant(
    request: GrantAgentPermissionRequest
  ): Promise<AgentMember> {
    const resp = await this.client.request(
      "POST",
      `/api/agents/${request.agent_id}/members`,
      JSON.stringify({
        user_id: request.user_id,
        permission: request.permission,
      } as z.infer<typeof schemaGrantAgentPermissionRequestBody>)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Revoke permission for a user or org default.
   *
   * @param request - The request body.
   */
  public async revoke(request: RevokeAgentPermissionRequest): Promise<void> {
    const query = new URLSearchParams();
    if (request.user_id) {
      query.set("user_id", request.user_id);
    }
    const resp = await this.client.request(
      "DELETE",
      `/api/agents/${request.agent_id}/members?${query.toString()}`
    );
    await assertResponseStatus(resp, 204);
  }
}
