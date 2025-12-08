import Layout from "@/app/(public)/layout";
import type { Meta, StoryObj } from "@storybook/react";
import SignupPage from "./page";

const meta: Meta = {
  title: "Page/Signup",
  component: SignupPage,
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

// Add Early Access variant
export const EarlyAccess: Story = {
  args: {
    searchParams: Promise.resolve({ ["early-access"]: "" } as any),
  },
};
