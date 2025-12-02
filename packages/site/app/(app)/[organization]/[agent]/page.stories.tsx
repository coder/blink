import { withFetch } from "@/.storybook/utils";
import Layout from "@/app/(app)/layout";
import { getQuerier } from "@/lib/database.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { mocked } from "@storybook/test";
import { SessionProvider } from "next-auth/react";
import OrganizationLayout from "../layout";
import AgentLayout from "./layout";
import AgentPage from "./page";

const meta: Meta<typeof AgentPage> = {
  title: "Page/Agent",
  component: AgentPage,
  args: {
    params: Promise.resolve({
      organization: "coder",
      agent: "blonk",
    }),
  },
  decorators: [
    (Story, { args }) => (
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
          <OrganizationLayout params={args.params}>
            <AgentLayout params={args.params}>
              <Story />
            </AgentLayout>
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
      selectAgentByOrganizationIDAndName: async () => ({
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
      }),
    });
  },
  decorators: [
    withFetch((url) => {
      if (!url.pathname.endsWith("/steps")) {
        return undefined;
      }

      return new Response(
        JSON.stringify({
          items: [],
          has_more: false,
        }),
        {
          status: 200,
        }
      );
    }),
  ],
};
