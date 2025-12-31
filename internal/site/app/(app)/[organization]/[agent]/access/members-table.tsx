"use client";

import Avatar from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentMember, OrganizationMember } from "@blink.so/api";
import { ArrowUpDown, Check, MoreVertical, Shield, User, Users } from "lucide-react";
import { useMemo, useState } from "react";

type SortField = "member" | "permission" | "source";
type SortDirection = "asc" | "desc";

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

// Unified member type for sorting
type UnifiedMember = {
  type: "explicit" | "implicit" | "inherited";
  displayName: string;
  username?: string;
  permission: "read" | "write" | "admin";
  source: string;
  sourceOrder: number; // Lower = higher priority (Direct first)
  permissionOrder: number; // For sorting by permission level
  userId?: string | null;
  avatarUrl?: string | null;
  orgRole?: string;
  originalMember: AgentMember | OrganizationMember;
};

const PERMISSION_DESCRIPTIONS = {
  read: "Can create chats, view own history, and view source code",
  write: "Read permissions plus: view all chats, create deployments, view logs & traces, manage env vars",
  admin: "Full control: change settings, manage member access, delete agent",
};

export function MembersTable({
  explicitMembers,
  implicitMembers,
  regularOrgMembers,
  agentVisibility,
  currentUserId,
  onDelete,
  onUpdatePermission,
}: MembersTableProps) {
  const [sortField, setSortField] = useState<SortField>("source");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Build a set of user IDs that have explicit grants (to exclude from inherited members)
  const explicitUserIds = new Set(
    explicitMembers.map((m) => m.user_id).filter(Boolean)
  );

  // Filter regular org members to exclude those with explicit grants
  const inheritedTeamMembers =
    agentVisibility === "organization"
      ? regularOrgMembers.filter((m) => !explicitUserIds.has(m.user.id))
      : [];

  // Create unified member list for sorting
  const unifiedMembers: UnifiedMember[] = useMemo(() => {
    const members: UnifiedMember[] = [];

    // Add explicit members (Direct)
    for (const member of explicitMembers) {
      members.push({
        type: "explicit",
        displayName: member.user
          ? member.user.display_name || member.user.username || "Unknown"
          : "Organization Default",
        username: member.user?.username,
        permission: member.permission,
        source: "Direct",
        sourceOrder: 0, // Direct first
        permissionOrder: member.permission === "admin" ? 0 : member.permission === "write" ? 1 : 2,
        userId: member.user_id,
        avatarUrl: member.user?.avatar_url,
        originalMember: member,
      });
    }

    // Add implicit members (org owners/admins)
    for (const member of implicitMembers) {
      members.push({
        type: "implicit",
        displayName: member.user.display_name || member.user.username || "Unknown",
        username: member.user.username,
        permission: "admin",
        source: `Team ${member.role}`,
        sourceOrder: 1, // Team admins/owners second
        permissionOrder: 0,
        userId: member.user.id,
        avatarUrl: member.user.avatar_url,
        orgRole: member.role,
        originalMember: member,
      });
    }

    // Add inherited team members
    for (const member of inheritedTeamMembers) {
      members.push({
        type: "inherited",
        displayName: member.user.display_name || member.user.username || "Unknown",
        username: member.user.username,
        permission: "read",
        source: "Team member",
        sourceOrder: 2, // Team members last
        permissionOrder: 2,
        userId: member.user.id,
        avatarUrl: member.user.avatar_url,
        orgRole: member.role,
        originalMember: member,
      });
    }

    return members;
  }, [explicitMembers, implicitMembers, inheritedTeamMembers]);

  // Sort members
  const sortedMembers = useMemo(() => {
    return [...unifiedMembers].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "member":
          comparison = a.displayName.localeCompare(b.displayName);
          break;
        case "permission":
          comparison = a.permissionOrder - b.permissionOrder;
          break;
        case "source":
          comparison = a.sourceOrder - b.sourceOrder;
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [unifiedMembers, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const SortableHeader = ({
    field,
    children,
    className = "",
  }: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      scope="col"
      className={`px-4 py-3 text-left text-xs text-neutral-500 dark:text-neutral-400 ${className}`}
    >
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
      >
        {children}
        <ArrowUpDown
          className={`h-3 w-3 ${sortField === field ? "text-neutral-700 dark:text-neutral-200" : "opacity-50"}`}
        />
      </button>
    </th>
  );

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
              <SortableHeader field="member" className="w-2/5">
                Member
              </SortableHeader>
              <SortableHeader field="permission" className="w-1/5">
                Permission
              </SortableHeader>
              <SortableHeader field="source" className="w-1/5">
                Source
              </SortableHeader>
              <th
                scope="col"
                className="px-4 py-3 text-right text-xs text-neutral-500 dark:text-neutral-400 w-1/5"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-neutral-950 divide-y divide-neutral-200 dark:divide-neutral-800">
            {sortedMembers.map((member) => (
              <MemberRow
                key={`${member.type}-${member.userId || "org-default"}`}
                member={member}
                currentUserId={currentUserId}
                onDelete={onDelete}
                onUpdatePermission={onUpdatePermission}
              />
            ))}
          </tbody>
        </table>
        {sortedMembers.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No members have been granted explicit access to this agent.
          </div>
        )}
      </div>
    </section>
  );
}

// Unified member row component
function MemberRow({
  member,
  currentUserId,
  onDelete,
  onUpdatePermission,
}: {
  member: UnifiedMember;
  currentUserId: string;
  onDelete: (userId: string | null) => void;
  onUpdatePermission: (
    userId: string | null,
    permission: "read" | "write" | "admin"
  ) => void;
}) {
  const isExplicit = member.type === "explicit";
  const isInherited = member.type === "inherited" || member.type === "implicit";
  const canEdit = isExplicit;

  const SourceIcon = member.type === "explicit" 
    ? User 
    : member.type === "implicit" 
      ? Shield 
      : Users;

  const getRemoveDisabledReason = (): string | null => {
    if (member.type === "implicit") {
      return `Cannot remove: ${member.displayName} has admin access as a team ${member.orgRole}. Change their team role to remove access.`;
    }
    if (member.type === "inherited") {
      return `Cannot remove: ${member.displayName} has read access as a team member. Change the agent's visibility to "Restricted" or remove them from the team.`;
    }
    return null;
  };

  const removeDisabledReason = getRemoveDisabledReason();

  return (
    <tr className={isInherited ? "bg-neutral-50/50 dark:bg-neutral-900/30" : ""}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {member.userId ? (
            <Avatar
              src={member.avatarUrl}
              seed={member.userId}
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
              {member.displayName}
            </div>
            {member.username && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                @{member.username}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-neutral-700 dark:text-neutral-300 cursor-help">
                {formatPermission(member.permission)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">{PERMISSION_DESCRIPTIONS[member.permission]}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <SourceIcon className="h-3.5 w-3.5" />
          <span className="capitalize">{member.source}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1 rounded"
              aria-label="Open actions menu"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canEdit && (
              <>
                <DropdownMenuLabel>Change Permission</DropdownMenuLabel>
                {(["read", "write", "admin"] as const).map((perm) => (
                  <DropdownMenuItem
                    key={perm}
                    onClick={() => {
                      if (perm !== member.permission) {
                        onUpdatePermission(member.userId ?? null, perm);
                      }
                    }}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{formatPermission(perm)}</div>
                      <div className="text-xs text-muted-foreground">
                        {perm === "read" && "Use agent, view source"}
                        {perm === "write" && "Deploy, view logs"}
                        {perm === "admin" && "Full control"}
                      </div>
                    </div>
                    {member.permission === perm && (
                      <Check className="h-4 w-4 text-green-600" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {removeDisabledReason ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <DropdownMenuItem
                        disabled
                        className="text-red-600 dark:text-red-400 opacity-50 cursor-not-allowed"
                      >
                        Remove
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-sm">{removeDisabledReason}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <DropdownMenuItem
                onClick={() => {
                  if (confirm(`Remove ${member.displayName} from this agent?`)) {
                    onDelete(member.userId ?? null);
                  }
                }}
                className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
              >
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function formatPermission(permission: string): string {
  return permission.charAt(0).toUpperCase() + permission.slice(1);
}
