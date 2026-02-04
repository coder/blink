import type { Meta, StoryObj } from "@storybook/react";
import { mocked } from "storybook/test";
import Layout from "@/app/(public)/layout";
import { getEmailDeliveryConfigured } from "@/lib/email-delivery.mock";
import ResetPasswordPage from "./page";

const meta: Meta = {
  title: "Page/ResetPassword",
  component: ResetPasswordPage,
  decorators: [
    (Story) => (
      <Layout>
        <Story />
      </Layout>
    ),
  ],
  beforeEach: () => {
    mocked(getEmailDeliveryConfigured).mockReturnValue(true);
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const EmailDeliveryDisabled: Story = {
  args: {},
  beforeEach: () => {
    mocked(getEmailDeliveryConfigured).mockReturnValue(false);
  },
};
