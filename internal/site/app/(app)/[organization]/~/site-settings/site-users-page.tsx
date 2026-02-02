"use client";

import type { SiteRole } from "@blink.so/api";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { useAPIClient } from "@/lib/api-client";
import { CreateUserModal } from "./create-user-modal";
import { SiteUsersLayout } from "./site-users-layout";
import { SiteUsersTable } from "./site-users-table";

export function SiteUsersPage() {
  const client = useAPIClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);

  // Reset to page 1 when filters or page size change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setPage(1);
  };

  const handleRoleFilterChange = (role: string) => {
    setRoleFilter(role);
    setPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const {
    data: usersData,
    isLoading,
    mutate,
  } = useSWR(
    ["admin-users", page, pageSize, searchQuery, roleFilter],
    async () => {
      return client.admin.users.list({
        page,
        per_page: pageSize,
        query: searchQuery || undefined,
        site_role: roleFilter !== "all" ? (roleFilter as SiteRole) : undefined,
      });
    }
  );

  const handleUpdateSuspension = useCallback(
    async (userId: string, suspended: boolean) => {
      await client.admin.users.updateSuspension(userId, suspended);
      await mutate();
    },
    [client, mutate]
  );

  // Show loading state when data hasn't loaded yet (handles initial hydration)
  const isLoadingUsers = isLoading || usersData === undefined;
  const users = usersData?.items || [];
  const hasMore = usersData?.has_more ?? false;

  return (
    <SiteUsersLayout>
      <SiteUsersTable
        users={users}
        isLoading={isLoadingUsers}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        roleFilter={roleFilter}
        onRoleFilterChange={handleRoleFilterChange}
        page={page}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        hasMore={hasMore}
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        onUpdateSuspension={handleUpdateSuspension}
        onCreateUser={() => setShowCreateUserModal(true)}
      />
      <CreateUserModal
        open={showCreateUserModal}
        onClose={() => setShowCreateUserModal(false)}
        onUserCreated={() => mutate()}
      />
    </SiteUsersLayout>
  );
}
