import { assertResponseStatus } from "../../client-helper";
import Client from "../../client.browser";
import type { Agent } from "../agents/agents.client";

export interface GetOrganizationAgentRequest {
  organization_id: string;
  agent_name: string;
}

export default class OrganizationAgents {
  private readonly client: Client;

  public constructor(client: Client) {
    this.client = client;
  }

  /**
   * Get an agent by name.
   *
   * @param request - The request object.
   * @returns The agent.
   */
  public async get(request: GetOrganizationAgentRequest): Promise<Agent> {
    const resp = await this.client.request(
      "GET",
      `/api/organizations/${request.organization_id}/agents/${request.agent_name}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}
