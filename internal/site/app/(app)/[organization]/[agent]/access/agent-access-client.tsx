"use client";

import { PageContainer, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Client from "@blink.so/api";
import { ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AddMemberModal } from "./add-member-modal";
import { MembersTable, type SortField, type SortDirection } from "./members-table";
import { PermissionsReferenceModal } from "./permissions-reference";
import { VisibilitySection } from "./visibility-section";

const PER_PAGE = 20;

// Map frontend sort fields to API order_by values
function getApiOrderBy(
  sortField: SortField,
  sortDirection: SortDirection
): string | undefined {
  const prefix = sortDirection === "desc" ? "-" : "";
  switch (sortField) {
    case "member":
      return `${prefix}name`;
    case "permission":
      return `${prefix}permission`;
    case "source":
      // Source sorting is frontend-only (combines explicit + implicit members)
      return undefined;
  }
}

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
  const [membersPage, setMembersPage] = useState(1);
  const [orgMembersPage, setOrgMembersPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("source");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const client = useMemo(() => new Client(), []);

  const apiOrderBy = getApiOrderBy(sortField, sortDirection);

  const { data: membersData, mutate: mutateMembers } = useSWR(
    ["agent-members", agentId, membersPage, apiOrderBy],
    async () => {
      return client.agents.members.list({
        agent_id: agentId,
        per_page: PER_PAGE,
        page: membersPage,
        order_by: (apiOrderBy as "permission" | "-permission" | "name" | "-name" | "created_at" | "-created_at") ?? "permission",
      });
    }
  );

  const { data: orgMembersData } = useSWR(
    ["organization-members-access", organizationId, orgMembersPage],
    async () => {
      return client.organizations.members.list({
        organization_id: organizationId,
        per_page: PER_PAGE,
        page: orgMembersPage,
        order_by: "role",
      });
    }
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    // Reset to first page when sorting changes
    setMembersPage(1);
  };

  const members = membersData?.items;
  const membersHasMore = membersData?.has_more ?? false;
  const orgMembers = orgMembersData?.items;
  const orgMembersHasMore = orgMembersData?.has_more ?? false;

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
    orgMembers?.filter((m) => m.role === "member" || m.role === "billing_admin") || [];

  // Filter out org admins and owners from the member list since they always have access
  const explicitMembers = (members || []).filter(
    (member) => !member.user_id || !orgAdminsAndOwnersIds.has(member.user_id)
  );

  // Check if there's more data on any page (indicates pagination is active)
  const hasPagination =
    membersPage > 1 ||
    membersHasMore ||
    orgMembersPage > 1 ||
    orgMembersHasMore;

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
                Manage who has access to this agent
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
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />

          {/* Pagination controls */}
          {hasPagination && (
            <div className="flex items-center justify-between border-t pt-4">
              <div className="text-sm text-muted-foreground">
                Page {Math.max(membersPage, orgMembersPage)}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMembersPage((p) => Math.max(1, p - 1));
                    setOrgMembersPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={membersPage <= 1 && orgMembersPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (membersHasMore) setMembersPage((p) => p + 1);
                    if (orgMembersHasMore) setOrgMembersPage((p) => p + 1);
                  }}
                  disabled={!membersHasMore && !orgMembersHasMore}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
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
