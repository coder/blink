import { usePathname } from "@storybook/nextjs-vite/navigation.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { SessionProvider } from "next-auth/react";
import { mocked } from "storybook/test";
import Layout from "@/app/(app)/layout";
import { withMockClient } from "@/lib/api-client.mock";
import {
  defaultAuthProviders,
  getAuthProviders,
} from "@/lib/auth-providers.mock";
import { getQuerier } from "@/lib/database.mock";
import OrganizationLayout from "../../layout";
import OrganizationSettingsLayout from "./layout";
import OrganizationSettingsPage from "./page";

const TEST_ORGANIZATION = "test";
const SETTINGS_PATHNAME = `/${TEST_ORGANIZATION}/~/settings`;

const setupUserSettingsMocks = async ({
  providers = defaultAuthProviders,
  githubLinked = true,
  googleLinked = false,
}: {
  providers?: typeof defaultAuthProviders;
  githubLinked?: boolean;
  googleLinked?: boolean;
} = {}) => {
  const baseQuerier = await getQuerier();
  mocked(usePathname).mockReturnValue(SETTINGS_PATHNAME);
  mocked(getAuthProviders).mockResolvedValue(providers);
  mocked(getQuerier).mockResolvedValue({
    ...baseQuerier,
    selectOrganizationForUser: async (params) => {
      const org = await baseQuerier.selectOrganizationForUser?.(params);
      return org ? { ...org, name: TEST_ORGANIZATION } : org;
    },
    selectUserAccountsByProviderAndUserID: async (
      provider: "github" | "google" | "slack",
      _userID: string
    ) => {
      if (provider === "github" && githubLinked) {
        return [
          {
            provider_account_id: "github-123",
            provider: "github" as const,
            user_id: "1",
            type: "oauth",
            access_token: null,
            refresh_token: null,
            expires_at: null,
            token_type: null,
            scope: null,
            id_token: null,
            session_state: null,
          },
        ];
      }
      if (provider === "google" && googleLinked) {
        return [
          {
            provider_account_id: "google-123",
            provider: "google" as const,
            user_id: "1",
            type: "oauth",
            access_token: null,
            refresh_token: null,
            expires_at: null,
            token_type: null,
            scope: null,
            id_token: null,
            session_state: null,
          },
        ];
      }
      return [];
    },
  });
};

const meta: Meta<typeof OrganizationSettingsPage> = {
  title: "Page/UserSettings",
  component: OrganizationSettingsPage,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: SETTINGS_PATHNAME,
      },
    },
  },
  args: {
    params: Promise.resolve({
      organization: TEST_ORGANIZATION,
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
    await setupUserSettingsMocks();
  },
};

export const OAuthDisabled: Story = {
  beforeEach: async () => {
    await setupUserSettingsMocks({
      providers: {
        credentials: {
          id: "credentials",
          name: "Credentials",
          type: "credentials",
        },
      },
      githubLinked: false,
      googleLinked: false,
    });
  },
};
