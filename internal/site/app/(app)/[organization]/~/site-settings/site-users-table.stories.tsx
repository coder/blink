import type { SiteUser } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SiteUsersTable } from "./site-users-table";

function InteractiveSiteUsersTable({
  users: initialUsers,
  ...props
}: React.ComponentProps<typeof SiteUsersTable>) {
  const [users, setUsers] = useState(initialUsers);
  const [searchQuery, setSearchQuery] = useState(props.searchQuery ?? "");
  const [roleFilter, setRoleFilter] = useState(props.roleFilter ?? "all");
  const [page, setPage] = useState(props.page ?? 1);
  const [pageSize, setPageSize] = useState(props.pageSize ?? 25);

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      searchQuery === "" ||
      user.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === "all" || user.site_role === roleFilter;

    return matchesSearch && matchesRole;
  });

  const paginatedUsers = filteredUsers.slice(
    (page - 1) * pageSize,
    page * pageSize
  );
  const hasMore = page * pageSize < filteredUsers.length;

  const handleUpdateSuspension = async (userId: string, suspended: boolean) => {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    setUsers((prev) =>
      prev.map((user) => (user.id === userId ? { ...user, suspended } : user))
    );
  };

  return (
    <SiteUsersTable
      {...props}
      users={paginatedUsers}
      searchQuery={searchQuery}
      onSearchChange={(q) => {
        setSearchQuery(q);
        setPage(1);
      }}
      roleFilter={roleFilter}
      onRoleFilterChange={(r) => {
        setRoleFilter(r);
        setPage(1);
      }}
      page={page}
      pageSize={pageSize}
      onPageSizeChange={(s) => {
        setPageSize(s);
        setPage(1);
      }}
      hasMore={hasMore}
      onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
      onNextPage={() => setPage((p) => p + 1)}
      onUpdateSuspension={handleUpdateSuspension}
    />
  );
}

const mockUsers: SiteUser[] = [
  {
    id: "1",
    created_at: new Date("2024-01-15"),
    updated_at: new Date("2024-01-15"),
    display_name: "Alice Admin",
    email: "alice@example.com",
    avatar_url: null,
    username: "alice",
    organization_id: "org-1",
    site_role: "admin",
    suspended: false,
  },
  {
    id: "2",
    created_at: new Date("2024-02-20"),
    updated_at: new Date("2024-02-20"),
    display_name: "Bob Builder",
    email: "bob@example.com",
    avatar_url: null,
    username: "bob",
    organization_id: "org-2",
    site_role: "member",
    suspended: false,
  },
  {
    id: "3",
    created_at: new Date("2024-03-10"),
    updated_at: new Date("2024-03-10"),
    display_name: null,
    email: "charlie@example.com",
    avatar_url: null,
    username: "charlie",
    organization_id: "org-3",
    site_role: "member",
    suspended: true,
  },
  {
    id: "4",
    created_at: new Date("2024-04-05"),
    updated_at: new Date("2024-04-05"),
    display_name: "Diana Developer",
    email: "diana@example.com",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    username: "diana",
    organization_id: "org-4",
    site_role: "admin",
    suspended: false,
  },
];

const meta: Meta<typeof InteractiveSiteUsersTable> = {
  title: "Page/SiteAdmin/SiteUsersTable",
  component: InteractiveSiteUsersTable,
  parameters: {
    layout: "padded",
  },
  args: {
    users: mockUsers,
    isLoading: false,
    searchQuery: "",
    roleFilter: "all",
    page: 1,
    pageSize: 25,
    hasMore: false,
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    users: [],
  },
};

export const SingleUser: Story = {
  args: {
    users: [mockUsers[0]],
  },
};

export const ManyUsers: Story = {
  args: {
    users: Array.from({ length: 50 }, (_, i) => ({
      id: `user-${i}`,
      created_at: new Date(2024, 0, i + 1),
      updated_at: new Date(2024, 0, i + 1),
      display_name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      avatar_url: null,
      username: `user${i + 1}`,
      organization_id: `org-${i}`,
      site_role: i % 5 === 0 ? ("admin" as const) : ("member" as const),
      suspended: i % 7 === 0,
    })),
  },
};

export const Loading: Story = {
  render: () => (
    <SiteUsersTable
      users={[]}
      isLoading={true}
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
      onUpdateSuspension={async () => {}}
    />
  ),
};

export const WithSuspendedUsers: Story = {
  args: {
    users: [
      {
        id: "1",
        created_at: new Date("2024-01-15"),
        updated_at: new Date("2024-01-15"),
        display_name: "Active Admin",
        email: "admin@example.com",
        avatar_url: null,
        username: "admin",
        organization_id: "org-1",
        site_role: "admin",
        suspended: false,
      },
      {
        id: "2",
        created_at: new Date("2024-02-20"),
        updated_at: new Date("2024-02-20"),
        display_name: "Suspended User",
        email: "suspended@example.com",
        avatar_url: null,
        username: "suspended",
        organization_id: "org-2",
        site_role: "member",
        suspended: true,
      },
      {
        id: "3",
        created_at: new Date("2024-03-10"),
        updated_at: new Date("2024-03-10"),
        display_name: "Another Suspended",
        email: "another@example.com",
        avatar_url: null,
        username: "another",
        organization_id: "org-3",
        site_role: "member",
        suspended: true,
      },
    ],
  },
};
