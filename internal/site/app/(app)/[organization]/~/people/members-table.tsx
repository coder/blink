import Avatar from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OrganizationMember } from "@blink.so/api";
import { ArrowUpDown, Filter, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemberActionsDropdown } from "./member-actions-dropdown";
import { formatDate, formatRole } from "./utils";

interface MembersTableProps {
  members: OrganizationMember[];
  isAdmin: boolean;
  viewerUserId: string;
  organizationId: string;
  onMemberUpdated?: () => void;
  onMemberRemoved?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  roleFilter: string;
  onRoleFilterChange: (role: string) => void;
  enableMultiOrg: boolean;
}

export function MembersTable({
  members,
  isAdmin,
  viewerUserId,
  organizationId,
  onMemberUpdated,
  onMemberRemoved,
  searchQuery,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  enableMultiOrg,
}: MembersTableProps) {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <section aria-labelledby="members-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className="flex items-center gap-2 px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
          >
            <Filter className="h-4 w-4" />
            <span>
              {roleFilter === "all" ? "All Roles" : formatRole(roleFilter)}
            </span>
          </button>

          {showFilterDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg z-10">
              {[
                { value: "all", label: "All Roles" },
                { value: "admin", label: "Admin" },
                { value: "member", label: "Member" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onRoleFilterChange(option.value);
                    setShowFilterDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 first:rounded-t-lg last:rounded-b-lg ${
                    roleFilter === option.value
                      ? "bg-neutral-50 dark:bg-neutral-800 font-medium"
                      : ""
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        {members.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No members found
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b bg-neutral-50 dark:bg-neutral-900/50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Member
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Role
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                    Joined
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                {isAdmin && (
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {members.map((member) => (
                <tr key={member.user.id}>
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <Avatar
                        src={member.user.avatar_url}
                        seed={member.user.organization_id}
                        size={32}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {member.user.username || "Unknown User"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {member.user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground cursor-help">
                            {formatRole(member.role)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="font-medium mb-1">
                            {member.role === "admin" ? "Admin" : "Member"}
                          </p>
                          <p className="text-xs">
                            {member.role === "admin"
                              ? "Has admin access to ALL agents and can manage members"
                              : "Can create agents (admin on created agents) and use all agents"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap text-muted-foreground">
                    Joined {formatDate(member.created_at)}
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 text-right">
                      {member.user.id !== viewerUserId && (
                        <MemberActionsDropdown
                          userId={member.user.id}
                          organizationId={organizationId}
                          userName={
                            member.user.display_name ||
                            member.user.username ||
                            member.user.email ||
                            "Unknown User"
                          }
                          currentRole={member.role}
                          onUpdated={onMemberUpdated}
                          onRemoved={onMemberRemoved}
                          enableMultiOrg={enableMultiOrg}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
