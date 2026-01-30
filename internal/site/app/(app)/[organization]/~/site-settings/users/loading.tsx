"use client";

import { SiteUsersLayout } from "../site-users-layout";
import { SiteUsersTable } from "../site-users-table";

export default function Loading() {
  return (
    <SiteUsersLayout>
      <SiteUsersTable
        users={[]}
        isLoading
        searchQuery=""
        onSearchChange={() => {}}
        roleFilter="all"
        onRoleFilterChange={() => {}}
        page={1}
        pageSize={25}
        onPageSizeChange={() => {}}
        hasMore={false}
        onPreviousPage={() => {}}
        onNextPage={() => {}}
      />
    </SiteUsersLayout>
  );
}
