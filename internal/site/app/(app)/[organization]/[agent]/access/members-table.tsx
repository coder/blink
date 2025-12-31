"use client";

import Avatar from "@/components/ui/avatar";
import type { AgentMember, OrganizationMember } from "@blink.so/api";
import { Shield, Users } from "lucide-react";
import { useState } from "react";

interface MembersTableProps {
  explicitMembers: AgentMember[];
  implicitMembers: OrganizationMember[];
  regularOrgMembers: OrganizationMember[];
  agentVisibility: "private" | "public" | "organization";
  currentUserId: string;
  onDelete: (userId: string | null) => void;
  onUpdatePermission: (
    userId: string | null,
    permission: "read" | "write" | "admin"
  ) => void;
}

export function MembersTable({
  explicitMembers,
  implicitMembers,
  regularOrgMembers,
  agentVisibility,
  currentUserId,
  onDelete,
  onUpdatePermission,
}: MembersTableProps) {
  // Build a set of user IDs that have explicit grants (to exclude from inherited members)
  const explicitUserIds = new Set(
    explicitMembers.map((m) => m.user_id).filter(Boolean)
  );

  // Filter regular org members to exclude those with explicit grants
  const inheritedTeamMembers =
    agentVisibility === "organization"
      ? regularOrgMembers.filter((m) => !explicitUserIds.has(m.user.id))
      : [];

  const totalCount =
    explicitMembers.length + implicitMembers.length + inheritedTeamMembers.length;

  return (
    <section aria-labelledby="members-heading">
      <div className="overflow-x-auto border border-neutral-200 dark:border-neutral-800 rounded-lg">
        <table
          className="w-full table-fixed"
          role="table"
          aria-label="Agent members"
        >
          <thead className="bg-neutral-50 dark:bg-neutral-900/50">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs text-neutral-500 dark:text-neutral-400 w-2/5"
              >
                Member
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs text-neutral-500 dark:text-neutral-400 w-1/5"
              >
                Permission
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs text-neutral-500 dark:text-neutral-400 w-1/5"
              >
                Source
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right text-xs text-neutral-500 dark:text-neutral-400 w-1/5"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-neutral-950 divide-y divide-neutral-200 dark:divide-neutral-800">
            {/* Implicit members (org owners and admins) */}
            {implicitMembers.map((orgMember) => (
              <ImplicitMemberRow
                key={`implicit-${orgMember.user.id}`}
                orgMember={orgMember}
              />
            ))}
            {/* Inherited team members (when visibility is organization) */}
            {inheritedTeamMembers.map((orgMember) => (
              <InheritedTeamMemberRow
                key={`team-${orgMember.user.id}`}
                orgMember={orgMember}
              />
            ))}
            {/* Explicit members */}
            {explicitMembers.map((member) => (
              <ExplicitMemberRow
                key={member.user_id || "org-default"}
                member={member}
                currentUserId={currentUserId}
                onDelete={onDelete}
                onUpdatePermission={onUpdatePermission}
              />
            ))}
          </tbody>
        </table>
        {totalCount === 0 && (
          <div className="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No members have been granted explicit access to this agent.
          </div>
        )}
      </div>
    </section>
  );
}

// Implicit member row for org owners/admins
function ImplicitMemberRow({ orgMember }: { orgMember: OrganizationMember }) {
  const displayName =
    orgMember.user.display_name || orgMember.user.username || "Unknown";

  return (
    <tr className="bg-neutral-50/50 dark:bg-neutral-900/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar
            src={orgMember.user.avatar_url}
            seed={orgMember.user.id}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-neutral-900 dark:text-white truncate">
              {displayName}
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              @{orgMember.user.username}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          Admin
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <Shield className="h-3.5 w-3.5" />
          <span className="capitalize">Team {orgMember.role}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          —
        </span>
      </td>
    </tr>
  );
}

// Inherited team member row for regular org members when visibility is "organization"
function InheritedTeamMemberRow({
  orgMember,
}: {
  orgMember: OrganizationMember;
}) {
  const displayName =
    orgMember.user.display_name || orgMember.user.username || "Unknown";

  return (
    <tr className="bg-neutral-50/50 dark:bg-neutral-900/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar
            src={orgMember.user.avatar_url}
            seed={orgMember.user.id}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-neutral-900 dark:text-white truncate">
              {displayName}
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              @{orgMember.user.username}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          Read
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <Users className="h-3.5 w-3.5" />
          <span>Team member</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          —
        </span>
      </td>
    </tr>
  );
}

// Explicit member row for directly granted permissions
function ExplicitMemberRow({
  member,
  currentUserId,
  onDelete,
  onUpdatePermission,
}: {
  member: AgentMember;
  currentUserId: string;
  onDelete: (userId: string | null) => void;
  onUpdatePermission: (
    userId: string | null,
    permission: "read" | "write" | "admin"
  ) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  const displayName = member.user
    ? member.user.display_name || member.user.username
    : "Organization Default";

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {member.user ? (
            <Avatar
              src={member.user.avatar_url}
              seed={member.user.id}
              size={32}
            />
          ) : (
            <div className="h-8 w-8 rounded-sm bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
              <span className="text-xs text-neutral-600 dark:text-neutral-300">
                ORG
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm text-neutral-900 dark:text-white truncate">
              {displayName}
            </div>
            {member.user && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                @{member.user.username}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {isEditing ? (
          <select
            value={member.permission}
            onChange={(e) => {
              const newPermission = e.target.value as
                | "read"
                | "write"
                | "admin";
              onUpdatePermission(member.user_id, newPermission);
              setIsEditing(false);
            }}
            onBlur={() => setIsEditing(false)}
            autoFocus
            className="text-sm border border-neutral-200 dark:border-neutral-700 rounded px-2 py-1 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white"
          >
            {formatPermission(member.permission)}
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Direct
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => {
            if (confirm(`Remove ${displayName} from this agent?`)) {
              onDelete(member.user_id);
            }
          }}
          className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

function formatPermission(permission: string): string {
  return permission.charAt(0).toUpperCase() + permission.slice(1);
}
