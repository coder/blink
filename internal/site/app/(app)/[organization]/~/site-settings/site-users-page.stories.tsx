import type { SiteUser } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import { SiteUsersPage } from "./site-users-page";

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

function configureMockClient(users: SiteUser[]) {
  return (client: MockedClient) => {
    client.admin.users.list.mockResolvedValue({
      items: users,
      has_more: false,
    });

    client.admin.users.create.mockResolvedValue({
      id: `user-${Date.now()}`,
      created_at: new Date(),
      updated_at: new Date(),
      display_name: "New User",
      email: "newuser@example.com",
      avatar_url: null,
      username: "newuser",
      organization_id: "org-new",
      site_role: "member",
      suspended: false,
    });

    client.admin.users.updateSuspension.mockImplementation(
      async (userId: string, suspended: boolean) => {
        const user = users.find((u) => u.id === userId);
        if (user) {
          return { ...user, suspended };
        }
        throw new Error("User not found");
      }
    );
  };
}

const meta: Meta<typeof SiteUsersPage> = {
  title: "Page/SiteAdmin/SiteUsersPage",
  component: SiteUsersPage,
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withMockClient(configureMockClient(mockUsers))],
};

export const Empty: Story = {
  decorators: [withMockClient(configureMockClient([]))],
};

export const SingleUser: Story = {
  decorators: [withMockClient(configureMockClient([mockUsers[0]]))],
};

export const ManyUsers: Story = {
  decorators: [
    withMockClient(
      configureMockClient(
        Array.from({ length: 50 }, (_, i) => ({
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
        }))
      )
    ),
  ],
};

export const Loading: Story = {
  decorators: [
    withMockClient((client) => {
      client.admin.users.list.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
    }),
  ],
};

export const WithSuspendedUsers: Story = {
  decorators: [
    withMockClient(
      configureMockClient([
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
      ])
    ),
  ],
};
