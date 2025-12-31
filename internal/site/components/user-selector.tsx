"use client";

import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Client from "@blink.so/api";
import { Check, ChevronsUpDown, Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

interface UserSelectorProps {
  organizationId: string;
  selectedUserId?: string | null;
  onSelect: (userId: string | null) => void;
  placeholder?: string;
  className?: string;
  includeOrganizationDefault?: boolean;
  excludeUserIds?: Set<string>;
}

export function UserSelector({
  organizationId,
  selectedUserId,
  onSelect,
  placeholder = "Select a user...",
  className,
  includeOrganizationDefault = false,
  excludeUserIds = new Set(),
}: UserSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const client = useMemo(() => new Client(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query - only when dropdown is open
  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, open]);

  // Reset search when dropdown closes, focus input when it opens
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setDebouncedQuery("");
    } else {
      // Focus input when dropdown opens (small delay to let it render)
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const { data: orgMembers, isLoading } = useSWR(
    ["organization-members", organizationId, debouncedQuery],
    async () => {
      const response = await client.organizations.members.list({
        organization_id: organizationId,
        query: debouncedQuery || undefined,
      });
      return response.items;
    },
    {
      // Keep previous data while revalidating to prevent flashing
      keepPreviousData: true,
    }
  );

  const selectedMember = useMemo(() => {
    if (!selectedUserId || selectedUserId === "") return null;
    return orgMembers?.find((m) => m.user.id === selectedUserId);
  }, [selectedUserId, orgMembers]);

  const filteredMembers = useMemo(() => {
    if (!orgMembers) return [];

    // Filter out excluded users
    return orgMembers.filter((member) => !excludeUserIds.has(member.user.id));
  }, [orgMembers, excludeUserIds]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
        >
          {selectedUserId === null && includeOrganizationDefault ? (
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Organization Default
            </span>
          ) : selectedMember ? (
            <span className="flex items-center gap-2">
              <Avatar
                src={selectedMember.user.avatar_url}
                seed={selectedMember.user.organization_id}
                alt={
                  selectedMember.user.display_name ||
                  selectedMember.user.username
                }
                size={20}
              />
              <span className="truncate">
                {selectedMember.user.display_name ||
                  selectedMember.user.username}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[300px] p-0" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            ref={inputRef}
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-8 border-0 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {includeOrganizationDefault && (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="cursor-pointer"
              >
                <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1">Organization Default</span>
                {selectedUserId === null && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Loading users...
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No users found
            </div>
          ) : (
            <>
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Organization Members
              </DropdownMenuLabel>
              {filteredMembers.map((member) => (
                <DropdownMenuItem
                  key={member.user.id}
                  onSelect={() => {
                    onSelect(member.user.id);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Avatar
                    src={member.user.avatar_url}
                    seed={member.user.organization_id}
                    alt={member.user.display_name || member.user.username}
                    size={20}
                    className="mr-2"
                  />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm">
                      {member.user.display_name || member.user.username}
                    </span>
                    {member.user.username && (
                      <span className="text-xs text-muted-foreground">
                        @{member.user.username}
                      </span>
                    )}
                  </div>
                  {selectedUserId === member.user.id && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
