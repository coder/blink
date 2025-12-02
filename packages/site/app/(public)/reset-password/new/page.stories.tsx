import { passwordResetVerifiedCookieName } from "@/app/(auth)/auth";
import Layout from "@/app/(public)/layout";
import { cookies } from "@storybook/experimental-nextjs-vite/headers.mock";
import type { Meta, StoryObj } from "@storybook/react";
import ResetPasswordNewPage from "./page";

const meta: Meta = {
  title: "Page/ResetPassword/New",
  component: ResetPasswordNewPage,
  decorators: [
    (Story) => (
      <Layout>
        <Story />
      </Layout>
    ),
  ],
  beforeEach: () => {
    cookies().set(passwordResetVerifiedCookieName, "fake-reset-verified-token");
  },
};

export default meta;
export type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
