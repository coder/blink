"use client";

import { Button } from "@/components/ui/button";
import { useAPIClient } from "@/lib/api-client";
import { Link as LinkIcon, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { InviteLinkModal } from "./invite-link-modal";
import { InviteMemberModal } from "./invite-member-modal";
import { MembersTable } from "./members-table";
import { OrganizationPermissionsReferenceModal } from "./organization-permissions-reference";
import { PendingInvitesTable } from "./pending-invites-table";

interface PeoplePageProps {
  organizationId: string;
  isAdmin: boolean;
  viewerUserId: string;
  enableMultiOrg: boolean;
  username: string;
}

export function PeoplePage({
  organizationId,
  isAdmin,
  viewerUserId,
  enableMultiOrg,
  username,
}: PeoplePageProps) {
  const client = useAPIClient();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showInviteLinkModal, setShowInviteLinkModal] = useState(false);

  useEffect(() => {
    if (searchParams.has("invite") && isAdmin) {
      setShowInviteModal(true);
    }
  }, [searchParams, isAdmin]);

  const { data: membersData, mutate: mutateMembers } = useSWR(
    ["organization-members", organizationId],
    async () => {
      return client.organizations.members.list({
        organization_id: organizationId,
        per_page: 100,
      });
    }
  );

  const { data: invites, mutate: mutateInvites } = useSWR(
    ["organization-invites", organizationId],
    async () => {
      return client.invites.list({
        organization_id: organizationId,
      });
    }
  );

  const members = membersData?.items || [];
  const invitesList = invites || [];
  const pendingEmailInvites = invitesList.filter((invite) => !invite.reusable);

  const filteredMembers = useMemo(() => {
    return members
      .filter((member) => {
        const matchesSearch =
          searchQuery === "" ||
          member.user.display_name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          member.user.username
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          member.user.email?.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesRole = roleFilter === "all" || member.role === roleFilter;

        return matchesSearch && matchesRole;
      })
      .sort((a, b) => {
        // Sort by role (admin > member), then by name
        const roleOrder = { admin: 0, member: 1, billing_admin: 2 };
        const roleCompare =
          roleOrder[a.role as keyof typeof roleOrder] -
          roleOrder[b.role as keyof typeof roleOrder];
        if (roleCompare !== 0) return roleCompare;

        const nameA =
          a.user.display_name || a.user.username || a.user.email || "";
        const nameB =
          b.user.display_name || b.user.username || b.user.email || "";
        return nameA.localeCompare(nameB);
      });
  }, [members, searchQuery, roleFilter]);

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage who has access to this organization
            </p>
          </div>
          <div className="flex items-center gap-4">
            <OrganizationPermissionsReferenceModal />
            {isAdmin && enableMultiOrg && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowInviteLinkModal(true)}
                >
                  <LinkIcon className="h-4 w-4" />
                  Invite Link
                </Button>
                <Button onClick={() => setShowInviteModal(true)}>
                  <UserPlus className="h-4 w-4" />
                  Invite Member
                </Button>
              </>
            )}
            {isAdmin && !enableMultiOrg && (
              <Button asChild>
                <Link href={`/${username}/~/site-settings`}>
                  <UserPlus className="h-4 w-4" />
                  Add Users
                </Link>
              </Button>
            )}
          </div>
        </div>

        <MembersTable
          members={filteredMembers}
          isAdmin={isAdmin}
          viewerUserId={viewerUserId}
          organizationId={organizationId}
          onMemberUpdated={mutateMembers}
          onMemberRemoved={mutateMembers}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          enableMultiOrg={enableMultiOrg}
        />
      </div>

      {isAdmin && pendingEmailInvites.length > 0 && (
        <PendingInvitesTable
          invites={pendingEmailInvites}
          organizationId={organizationId}
          onInviteDeleted={mutateInvites}
        />
      )}

      <InviteMemberModal
        organizationId={organizationId}
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInviteCreated={() => {
          mutateInvites();
        }}
      />

      <InviteLinkModal
        organizationId={organizationId}
        isOpen={showInviteLinkModal}
        onClose={() => setShowInviteLinkModal(false)}
      />
    </div>
  );
}
