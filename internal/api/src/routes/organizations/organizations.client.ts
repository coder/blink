import { z } from "zod";
import { assertResponseStatus, nameFormat } from "../../client-helper";
import Client from "../../client.browser";
import OrganizationAgents from "./agents.client";
import OrganizationMembers, {
  schemaOrganizationMembership,
} from "./members.client";

// Re-export member types
export type { OrganizationMember } from "./members.client";

export const schemaOrganization = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(["organization", "personal"]),
  created_at: z.date(),
  updated_at: z.date(),
  membership: schemaOrganizationMembership.nullable(),

  members_url: z.url(),
  invites_url: z.url(),
  avatar_url: z.url().nullable(),
});

export type Organization = z.infer<typeof schemaOrganization>;

export const schemaCreateOrganizationRequest = z.object({
  name: z.string().regex(nameFormat),
});

export type CreateOrganizationRequest = z.infer<
  typeof schemaCreateOrganizationRequest
>;

export const schemaUpdateOrganizationRequest = z.object({
  name: z.string().max(100).optional(),
  avatar_file_id: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
});

export type UpdateOrganizationRequest = z.infer<
  typeof schemaUpdateOrganizationRequest
>;

export default class Organizations {
  private readonly client: Client;
  public readonly members: OrganizationMembers;
  public readonly agents: OrganizationAgents;

  public constructor(client: Client) {
    this.client = client;
    this.members = new OrganizationMembers(client);
    this.agents = new OrganizationAgents(client);
  }

  /**
   * List all organizations the user is a member of.
   *
   * @returns A list of organizations.
   */
  public async list(): Promise<Organization[]> {
    const resp = await this.client.request("GET", "/api/organizations");
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Get an organization by ID.
   *
   * @param id - The ID of the organization.
   * @returns The organization.
   */
  public async get(id: string): Promise<Organization> {
    const resp = await this.client.request("GET", `/api/organizations/${id}`);
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Create a new organization.
   *
   * @param request - The request body.
   * @returns The created organization.
   */
  public async create(
    request: CreateOrganizationRequest
  ): Promise<Organization> {
    const resp = await this.client.request(
      "POST",
      "/api/organizations",
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 201);
    return resp.json();
  }

  /**
   * Update an organization by ID.
   *
   * @param id - The ID of the organization.
   * @param request - The update request.
   * @returns The updated organization.
   */
  public async update(
    id: string,
    request: UpdateOrganizationRequest
  ): Promise<Organization> {
    const resp = await this.client.request(
      "PATCH",
      `/api/organizations/${id}`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete an organization by ID.
   *
   * @param id - The ID of the organization.
   * @returns The deleted organization.
   */
  public async delete(id: string): Promise<void> {
    const resp = await this.client.request(
      "DELETE",
      `/api/organizations/${id}`
    );
    await assertResponseStatus(resp, 204);
  }
}
