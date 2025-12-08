import { emailVerificationTokenCookieName } from "@/app/(auth)/auth";
import Layout from "@/app/(public)/layout";
import { cookies } from "@storybook/experimental-nextjs-vite/headers.mock";
import type { Meta, StoryObj } from "@storybook/react";
import EmailVerificationPage from "./page";

const meta: Meta = {
  title: "Page/EmailVerification",
  component: EmailVerificationPage,
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
  beforeEach: () => {
    cookies().set(emailVerificationTokenCookieName, "fake-token");
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Error: Story = {
  args: {
    searchParams: Promise.resolve({ error: "Invalid code" }),
  },
};

export const Resent: Story = {
  args: {
    searchParams: Promise.resolve({ resent: "1" }),
  },
};
