import { describe, expect, test } from "bun:test";
import connectToPostgres from "./postgres";
import Querier from "./querier";
import {
  createPostgresURL,
  createTestAgent,
  createTestOrganization,
  createTestUser,
} from "./test";

describe("Agent Permissions", () => {
  test("creator gets admin permission on agent creation", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user.id });

    const agent = await querier.tx(async (tx) => {
      const agent = await tx.insertAgent({
        name: "test-agent",
        description: "Test agent",
        organization_id: org.id,
        created_by: user.id,
        visibility: "private",
      });

      // Grant admin permission to creator
      await tx.upsertAgentPermission({
        agent_id: agent.id,
        user_id: user.id,
        permission: "admin",
        created_by: user.id,
      });

      return agent;
    });

    // Verify the permission was created
    const permission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: user.id,
    });

    expect(permission).toBe("admin");
  });

  test("upsert updates existing permission", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: user.id,
    });

    // Grant read permission
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user.id,
      permission: "read",
      created_by: user.id,
    });

    let permission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: user.id,
    });
    expect(permission).toBe("read");

    // Update to write permission
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user.id,
      permission: "write",
      created_by: user.id,
    });

    permission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: user.id,
    });
    expect(permission).toBe("write");
  });

  test("org-level default permission applies to all members", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user1 = await createTestUser(querier);
    const user2 = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user1.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: user1.id,
    });

    // Add user2 to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: user2.id,
      role: "member",
    });

    // Set org-level default permission (null user_id)
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: undefined,
      permission: "read",
      created_by: user1.id,
    });

    // User2 should get the org-level permission
    const permission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: user2.id,
      orgRole: "member",
    });

    expect(permission).toBe("read");
  });

  test("user-specific permission overrides org default", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user1 = await createTestUser(querier);
    const user2 = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user1.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: user1.id,
    });

    // Add user2 to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: user2.id,
      role: "member",
    });

    // Set org-level default to read
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: undefined,
      permission: "read",
      created_by: user1.id,
    });

    // Give user2 admin permission explicitly
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user2.id,
      permission: "admin",
      created_by: user1.id,
    });

    const permission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: user2.id,
      orgRole: "member",
    });

    expect(permission).toBe("admin");
  });

  test("org owners and admins get admin by default for organization visibility", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const admin = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "organization",
    });

    // Add admin user
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: admin.id,
      role: "admin",
    });

    // Owner should get admin (since they're the org owner)
    const ownerPermission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: owner.id,
      orgRole: "owner",
      agentVisibility: "organization",
    });
    expect(ownerPermission).toBe("admin");

    // Admin should get admin
    const adminPermission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: admin.id,
      orgRole: "admin",
      agentVisibility: "organization",
    });
    expect(adminPermission).toBe("admin");
  });

  test("selectAgentPermissions lists all permissions", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user1 = await createTestUser(querier);
    const user2 = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user1.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: user1.id,
    });

    // Add permissions
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user1.id,
      permission: "admin",
      created_by: user1.id,
    });

    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user2.id,
      permission: "read",
      created_by: user1.id,
    });

    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: undefined,
      permission: "write",
      created_by: user1.id,
    });

    const result = await querier.selectAgentPermissions({
      agentId: agent.id,
    });

    expect(result.items.length).toBe(3);
    expect(
      result.items.some(
        (p) => p.user_id === user1.id && p.permission === "admin"
      )
    ).toBe(true);
    expect(
      result.items.some(
        (p) => p.user_id === user2.id && p.permission === "read"
      )
    ).toBe(true);
    expect(
      result.items.some((p) => p.user_id === null && p.permission === "write")
    ).toBe(true);
  });

  test("deleteAgentPermission removes permission", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: user.id,
    });

    // Add permission
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user.id,
      permission: "admin",
      created_by: user.id,
    });

    // Verify it exists
    let permissions = await querier.selectAgentPermissions({
      agentId: agent.id,
    });
    expect(permissions.items.length).toBe(1);

    // Delete it
    await querier.deleteAgentPermission({
      agent_id: agent.id,
      user_id: user.id,
    });

    // Verify it's gone
    permissions = await querier.selectAgentPermissions({
      agentId: agent.id,
    });
    expect(permissions.items.length).toBe(0);
  });

  test("agent deletion cascades to permissions", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const user = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: user.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: user.id,
    });

    // Add permission
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: user.id,
      permission: "admin",
      created_by: user.id,
    });

    // Delete agent
    await querier.deleteAgent({ id: agent.id });

    // Permissions should be cascade deleted
    const permissions = await querier.selectAgentPermissions({
      agentId: agent.id,
    });
    expect(permissions.items.length).toBe(0);
  });

  test("organization visibility: all org members can access", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const member = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "organization",
    });

    // Add member to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: member.id,
      role: "member",
    });

    // Member should get read permission by default for organization visibility
    const memberPermission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: member.id,
      orgRole: "member",
      agentVisibility: "organization",
    });
    expect(memberPermission).toBe("read");
  });

  test("private visibility: only org admins/owners can access by default", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const member = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "private",
    });

    // Add member to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: member.id,
      role: "member",
    });

    // Owner should still have admin access
    const ownerPermission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: owner.id,
      orgRole: "owner",
      agentVisibility: "private",
    });
    expect(ownerPermission).toBe("admin");

    // Member should NOT have access
    const memberPermission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: member.id,
      orgRole: "member",
      agentVisibility: "private",
    });
    expect(memberPermission).toBeUndefined();
  });

  test("private visibility: explicit permission grants access", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const member = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });
    const agent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "private",
    });

    // Add member to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: member.id,
      role: "member",
    });

    // Grant explicit read permission to member
    await querier.upsertAgentPermission({
      agent_id: agent.id,
      user_id: member.id,
      permission: "read",
      created_by: owner.id,
    });

    // Now member should have read access
    const memberPermission = await querier.getAgentPermissionForUser({
      agentId: agent.id,
      userId: member.id,
      orgRole: "member",
      agentVisibility: "private",
    });
    expect(memberPermission).toBe("read");
  });

  test("selectAgentsForUser respects organization visibility", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const member = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });

    // Create organization-visible agent
    const orgAgent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "organization",
      name: "org-agent",
    });

    // Add member to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: member.id,
      role: "member",
    });

    // Member should see the organization-visible agent
    const agents = await querier.selectAgentsForUser({
      userID: member.id,
      organizationID: org.id,
    });

    expect(agents.items.length).toBe(1);
    expect(agents.items[0]!.id).toBe(orgAgent.id);
  });

  test("selectAgentsForUser excludes private agents from regular members", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const member = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });

    // Create private agent
    const privateAgent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "private",
      name: "private-agent",
    });

    // Add member to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: member.id,
      role: "member",
    });

    // Member should NOT see the private agent
    const memberAgents = await querier.selectAgentsForUser({
      userID: member.id,
      organizationID: org.id,
    });
    expect(memberAgents.items.length).toBe(0);

    // Owner should see the private agent
    const ownerAgents = await querier.selectAgentsForUser({
      userID: owner.id,
      organizationID: org.id,
    });
    expect(ownerAgents.items.length).toBe(1);
    expect(ownerAgents.items[0]!.id).toBe(privateAgent.id);
  });

  test("selectAgentsForUser shows private agents to members with explicit permission", async () => {
    const url = await createPostgresURL();
    const querier = new Querier(await connectToPostgres(url));

    const owner = await createTestUser(querier);
    const member = await createTestUser(querier);
    const org = await createTestOrganization(querier, { created_by: owner.id });

    // Create private agent
    const privateAgent = await createTestAgent(querier, {
      organization_id: org.id,
      created_by: owner.id,
      visibility: "private",
      name: "private-agent",
    });

    // Add member to org
    await querier.insertOrganizationMembership({
      organization_id: org.id,
      user_id: member.id,
      role: "member",
    });

    // Grant explicit permission to member
    await querier.upsertAgentPermission({
      agent_id: privateAgent.id,
      user_id: member.id,
      permission: "read",
      created_by: owner.id,
    });

    // Now member should see the private agent
    const agents = await querier.selectAgentsForUser({
      userID: member.id,
      organizationID: org.id,
    });
    expect(agents.items.length).toBe(1);
    expect(agents.items[0]!.id).toBe(privateAgent.id);
  });
});
