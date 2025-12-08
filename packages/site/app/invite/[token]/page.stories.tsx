import { auth, fakeTeam } from "@/app/(auth)/auth.mock";
import Layout from "@/app/layout";
import { getQuerier } from "@/lib/database.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { mocked } from "@storybook/test";
import InvitePage from "./page";

const meta: Meta = {
  title: "Page/Invite",
  component: InvitePage,
  decorators: [
    (Story) => (
      <Layout>
        <Story />
      </Layout>
    ),
  ],
  args: {
    searchParams: Promise.resolve({}),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Expired: Story = {
  args: {
    params: {
      token: "123",
    },
  },
  beforeEach: async () => {
    mocked(getQuerier).mockResolvedValue({
      ...(await getQuerier()),
      selectOrganizationInviteWithOrganizationByToken: async () => ({
        organization_invite: {
          id: "1",
          code: "123",
          created_at: new Date(),
          email: "test@test.com",
          organization_id: "1",
          invited_by: "1",
          role: "admin",
          reusable: false,
          expires_at: new Date(Date.now() - 1000),
          last_accepted_at: null,
          updated_at: new Date(),
        },
        organization: fakeTeam,
      }),
    });
  },
};

export const AlreadyUsed: Story = {
  args: {
    params: {
      token: "123",
    },
  },
  beforeEach: async () => {
    mocked(getQuerier).mockResolvedValue({
      ...(await getQuerier()),
      selectOrganizationInviteWithOrganizationByToken: async () => ({
        organization_invite: {
          id: "1",
          code: "123",
          created_at: new Date(),
          email: "test@test.com",
          organization_id: "1",
          invited_by: "1",
          role: "admin",
          reusable: false,
          expires_at: new Date(Date.now() + 1000),
          last_accepted_at: new Date(),
          updated_at: new Date(),
        },
        organization: fakeTeam,
      }),
    });
  },
};

export const Authenticated: Story = {
  args: {
    params: {
      token: "123",
    },
  },
  beforeEach: async () => {
    mocked(getQuerier).mockResolvedValue({
      ...(await getQuerier()),
      selectOrganizationInviteWithOrganizationByToken: async () => ({
        organization_invite: {
          id: "1",
          code: "123",
          created_at: new Date(),
          email: "test@test.com",
          organization_id: "1",
          invited_by: "1",
          role: "admin",
          reusable: false,
          expires_at: null,
          last_accepted_at: null,
          updated_at: new Date(),
        },
        organization: fakeTeam,
      }),
      selectOrganizationMembershipByUserIDAndOrganizationID: async () =>
        undefined,
    });
  },
};

export const Unauthenticated: Story = {
  args: {
    params: {
      token: "123",
    },
  },
  beforeEach: async () => {
    mocked(getQuerier).mockResolvedValue({
      ...(await getQuerier()),
      selectOrganizationInviteWithOrganizationByToken: async () => ({
        organization_invite: {
          id: "1",
          code: "123",
          created_at: new Date(),
          email: "test@test.com",
          organization_id: "1",
          invited_by: "1",
          role: "admin",
          reusable: false,
          expires_at: null,
          last_accepted_at: null,
          updated_at: new Date(),
        },
        organization: fakeTeam,
      }),
      selectOrganizationMembershipByUserIDAndOrganizationID: async () =>
        undefined,
    });

    mocked(auth).mockResolvedValue(null);
  },
};
