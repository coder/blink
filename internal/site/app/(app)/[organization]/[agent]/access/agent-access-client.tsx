"use client";

import { PageContainer, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Client from "@blink.so/api";
import { UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AddMemberModal } from "./add-member-modal";
import { MembersTable } from "./members-table";
import { PermissionsReferenceModal } from "./permissions-reference";
import { VisibilitySection } from "./visibility-section";

interface AgentAccessClientProps {
  agentId: string;
  organizationId: string;
  agentVisibility: "private" | "public" | "organization";
  currentUserId: string;
  organizationName: string;
}

export function AgentAccessClient({
  agentId,
  organizationId,
  agentVisibility,
  currentUserId,
  organizationName,
}: AgentAccessClientProps) {
  const [isAddingMember, setIsAddingMember] = useState(false);
  const client = useMemo(() => new Client(), []);

  const { data: members, mutate: mutateMembers } = useSWR(
    ["agent-members", agentId],
    async () => {
      const response = await client.agents.members.list({
        agent_id: agentId,
      });
      return response.items;
    }
  );

  const { data: orgMembers } = useSWR(
    ["organization-members", organizationId],
    async () => {
      const response = await client.organizations.members.list({
        organization_id: organizationId,
      });
      return response.items;
    }
  );

  const handleDelete = async (userId: string | null) => {
    await client.agents.members.revoke({
      agent_id: agentId,
      user_id: userId,
    });
    mutateMembers();
  };

  const handleUpdatePermission = async (
    userId: string | null,
    permission: "read" | "write" | "admin"
  ) => {
    await client.agents.members.grant({
      agent_id: agentId,
      user_id: userId,
      permission,
    });
    mutateMembers();
  };

  // Get organization admins and owners - they have implicit admin access
  const orgAdminsAndOwners =
    orgMembers?.filter((m) => m.role === "owner" || m.role === "admin") || [];

  const orgAdminsAndOwnersIds = new Set(
    orgAdminsAndOwners.map((m) => m.user.id)
  );

  // Get regular org members (not admins/owners) - they get read access when visibility is organization
  const regularOrgMembers =
    orgMembers?.filter((m) => m.role === "member") || [];

  // Filter out org admins and owners from the member list since they always have access
  const explicitMembers = (members || []).filter(
    (member) => !member.user_id || !orgAdminsAndOwnersIds.has(member.user_id)
  );

  // Total count depends on visibility
  const totalMembersCount =
    agentVisibility === "organization"
      ? (orgMembers?.length || 0) // When team visible, all org members have access
      : explicitMembers.length + orgAdminsAndOwners.length;

  return (
    <PageContainer>
      <PageHeader
        title="Access"
        description="Manage who can access this agent and their permissions."
      />

      <div className="space-y-8">
        <VisibilitySection
          agentId={agentId}
          currentVisibility={agentVisibility}
          organizationName={organizationName}
        />

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Members</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {totalMembersCount}{" "}
                {totalMembersCount === 1 ? "member has" : "members have"} access
                to this agent
              </p>
            </div>
            <div className="flex items-center gap-4">
              <PermissionsReferenceModal />
              <Button onClick={() => setIsAddingMember(true)}>
                <UserPlus className="h-4 w-4" />
                Add Member
              </Button>
            </div>
          </div>

          <MembersTable
            explicitMembers={explicitMembers}
            implicitMembers={orgAdminsAndOwners}
            regularOrgMembers={regularOrgMembers}
            agentVisibility={agentVisibility}
            currentUserId={currentUserId}
            onDelete={handleDelete}
            onUpdatePermission={handleUpdatePermission}
          />
        </div>

        <AddMemberModal
          agentId={agentId}
          organizationId={organizationId}
          orgAdminsAndOwners={orgAdminsAndOwnersIds}
          isOpen={isAddingMember}
          onClose={() => setIsAddingMember(false)}
          onSuccess={() => {
            mutateMembers();
          }}
        />
      </div>
    </PageContainer>
  );
}
