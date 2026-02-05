import { usePathname } from "@storybook/nextjs-vite/navigation.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { SessionProvider } from "next-auth/react";
import { mocked } from "storybook/test";
import Layout from "@/app/(app)/layout";
import { withMockClient } from "@/lib/api-client.mock";
import { getQuerier } from "@/lib/database.mock";
import { getEnableMultiOrg } from "@/lib/multi-org.mock";
import OrganizationLayout from "../../layout";
import OrganizationSettingsLayout from "./layout";
import OrganizationSettingsPage from "./page";

const TEAM_ORGANIZATION = "team-org";
const TEAM_SETTINGS_PATHNAME = `/${TEAM_ORGANIZATION}/~/settings`;

const setupTeamOrgSettingsMocks = async () => {
  const baseQuerier = await getQuerier();
  mocked(usePathname).mockReturnValue(TEAM_SETTINGS_PATHNAME);
  mocked(getQuerier).mockResolvedValue({
    ...baseQuerier,
    selectOrganizationForUser: async (params) => {
      const org = await baseQuerier.selectOrganizationForUser?.(params);
      return org
        ? {
            ...org,
            id: "2", // Different from user's personal org (id: 1)
            name: TEAM_ORGANIZATION,
            kind: "organization" as const,
          }
        : org;
    },
  });
};

const meta: Meta<typeof OrganizationSettingsPage> = {
  title: "Page/OrganizationSettings",
  component: OrganizationSettingsPage,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: TEAM_SETTINGS_PATHNAME,
      },
    },
  },
  args: {
    params: Promise.resolve({
      organization: TEAM_ORGANIZATION,
    }),
  },
  decorators: [
    withMockClient((client) => {
      client.auth.changePassword.mockResolvedValue({ ok: true });
    }),
    (Story, { args }) => (
      <SessionProvider
        refetchOnWindowFocus={false}
        session={{
          user: {
            id: "1",
            email: "test@blink.so",
            organization_id: "1",
          },
          expires: "2099-01-01T00:00:00.000Z",
        }}
      >
        <Layout>
          <OrganizationLayout params={args.params}>
            <OrganizationSettingsLayout params={args.params}>
              <Story />
            </OrganizationSettingsLayout>
          </OrganizationLayout>
        </Layout>
      </SessionProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: async () => {
    await setupTeamOrgSettingsMocks();
  },
};

export const MultiOrgDisabled: Story = {
  beforeEach: async () => {
    await setupTeamOrgSettingsMocks();
    mocked(getEnableMultiOrg).mockReturnValue(false);
  },
};
