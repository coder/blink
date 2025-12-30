import Layout from "@/app/(public)/layout";
import type { Meta, StoryObj } from "@storybook/react";
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
  args: {
    searchParams: Promise.resolve({}),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
