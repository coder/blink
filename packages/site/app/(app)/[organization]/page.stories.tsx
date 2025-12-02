import Layout from "@/app/(app)/layout";
import { getQuerier } from "@/lib/database.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { mocked } from "@storybook/test";
import { SessionProvider } from "next-auth/react";
import OrganizationLayout from "./layout";
import OrganizationPage from "./page";

const meta: Meta<typeof OrganizationPage> = {
  title: "Page/Organization",
  component: OrganizationPage,
  args: {
    params: Promise.resolve({
      organization: "coder",
    }),
  },
  decorators: [
    (Story) => (
      <SessionProvider
        refetchOnWindowFocus={false}
        session={{
          user: {
            id: "1",
            email: "test@blink.so",
          },
          expires: "2099-01-01T00:00:00.000Z",
        }}
      >
        <Layout>
          <OrganizationLayout
            params={Promise.resolve({ organization: "coder" })}
          >
            <Story />
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
    mocked(getQuerier).mockResolvedValue({
      ...(await getQuerier()),
      selectAgentsByOrganizationID: async (_params: {
        organizationID: string;
        userID: string;
      }) => ({
        items: [
          {
            id: "1",
            name: "Blonk",
            created_at: new Date(),
            updated_at: new Date(),
            organization_id: "1",
            created_by: "1",
            visibility: "private",
            description: "Test Agent",
            avatar_file_id: null,
            webhook_id: "1",
            active_deployment_id: null,
            chat_expire_ttl: null,
            last_deployment_number: 0,
            last_run_number: 0,
            active_deployment_created_by: "1",
            active_deployment_created_at: new Date(),
          },
          {
            id: "2",
            name: "Weather Bot",
            created_at: new Date(),
            updated_at: new Date(),
            organization_id: "1",
            created_by: "1",
            visibility: "private",
            description: "I'm a magical bot for the weather",
            avatar_file_id: null,
            webhook_id: "1",
            active_deployment_id: null,
            chat_expire_ttl: null,
            last_deployment_number: 0,
            last_run_number: 0,
            active_deployment_created_by: null,
            active_deployment_created_at: null,
          },
        ],
        has_more: false,
      }),
    });
  },
};
