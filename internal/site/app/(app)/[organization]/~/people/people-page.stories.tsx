import type { OrganizationMember } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { mocked } from "storybook/test";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import { getEnableMultiOrg } from "@/lib/multi-org.mock";
import { PeoplePage } from "./people-page";

const mockMembers: OrganizationMember[] = [
  {
    organization_id: "org-1",
    user_id: "user-1",
    created_at: new Date("2024-01-15"),
    updated_at: new Date("2024-01-15"),
    role: "owner",
    user: {
      id: "user-1",
      created_at: new Date("2024-01-15"),
      updated_at: new Date("2024-01-15"),
      display_name: "Alice Owner",
      email: "alice@example.com",
      avatar_url: null,
      username: "alice",
      organization_id: "personal-org-1",
    },
  },
  {
    organization_id: "org-1",
    user_id: "user-2",
    created_at: new Date("2024-02-20"),
    updated_at: new Date("2024-02-20"),
    role: "admin",
    user: {
      id: "user-2",
      created_at: new Date("2024-02-20"),
      updated_at: new Date("2024-02-20"),
      display_name: "Bob Admin",
      email: "bob@example.com",
      avatar_url: null,
      username: "bob",
      organization_id: "personal-org-2",
    },
  },
  {
    organization_id: "org-1",
    user_id: "user-3",
    created_at: new Date("2024-03-10"),
    updated_at: new Date("2024-03-10"),
    role: "member",
    user: {
      id: "user-3",
      created_at: new Date("2024-03-10"),
      updated_at: new Date("2024-03-10"),
      display_name: "Charlie Member",
      email: "charlie@example.com",
      avatar_url: null,
      username: "charlie",
      organization_id: "personal-org-3",
    },
  },
  {
    organization_id: "org-1",
    user_id: "user-4",
    created_at: new Date("2024-04-05"),
    updated_at: new Date("2024-04-05"),
    role: "member",
    user: {
      id: "user-4",
      created_at: new Date("2024-04-05"),
      updated_at: new Date("2024-04-05"),
      display_name: "Diana Developer",
      email: "diana@example.com",
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
      username: "diana",
      organization_id: "personal-org-4",
    },
  },
];

function configureMockClient(members: OrganizationMember[]) {
  return (client: MockedClient) => {
    client.organizations.members.list.mockResolvedValue({
      items: members,
      has_more: false,
    });

    client.organizations.members.update.mockImplementation(
      async ({ user_id, role }) => {
        const member = members.find((m) => m.user_id === user_id);
        if (member) {
          return { ...member, role: role ?? member.role };
        }
        throw new Error("Member not found");
      }
    );

    client.organizations.members.delete.mockResolvedValue(undefined);

    client.invites.list.mockResolvedValue([]);
  };
}

const meta: Meta<typeof PeoplePage> = {
  title: "Page/Organization/PeoplePage",
  component: PeoplePage,
  parameters: {
    layout: "padded",
  },
  args: {
    organizationId: "org-1",
    username: "alice",
    isAdmin: true,
    viewerUserId: "user-1",
    enableMultiOrg: true,
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const MultiOrgEnabled: Story = {
  args: {
    enableMultiOrg: true,
  },
  decorators: [withMockClient(configureMockClient(mockMembers))],
};

export const MultiOrgDisabled: Story = {
  args: {
    enableMultiOrg: false,
  },
  beforeEach: async () => {
    mocked(getEnableMultiOrg).mockReturnValue(false);
  },
  decorators: [withMockClient(configureMockClient(mockMembers))],
};

export const AsNonAdmin: Story = {
  args: {
    isAdmin: false,
    viewerUserId: "user-3",
  },
  decorators: [withMockClient(configureMockClient(mockMembers))],
};

export const Empty: Story = {
  decorators: [withMockClient(configureMockClient([]))],
};
