import Layout from "@/app/(public)/layout";
import { cookies } from "@storybook/experimental-nextjs-vite/headers.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { mocked } from "@storybook/test";
import LoginPage from "./page";

const meta: Meta<typeof LoginPage> = {
  title: "Page/Login",
  component: LoginPage,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/login",
      },
    },
  },
  decorators: [
    (Story) => (
      <Layout>
        <Story />
      </Layout>
    ),
  ],
};

export default meta;

export type LoginPageProps = React.ComponentProps<typeof LoginPage>;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { searchParams: Promise.resolve({}) },
};

export const Error: Story = {
  args: {
    searchParams: Promise.resolve({ error: "Invalid email or password" }),
  },
};

export const LastGithub: Story = {
  args: { searchParams: Promise.resolve({}) },
  beforeEach: async () =>
    mocked(cookies).mockResolvedValue({
      // @ts-expect-error
      get: (n: string) =>
        n === "last_login_provider" ? { value: "github" } : undefined,
    }),
};

export const LastGoogle: Story = {
  args: { searchParams: Promise.resolve({}) },
  beforeEach: () =>
    mocked(cookies).mockResolvedValue({
      // @ts-expect-error
      get: (n: string) =>
        n === "last_login_provider" ? { value: "google" } : undefined,
    }),
};

export const LastCredentials: Story = {
  args: { searchParams: Promise.resolve({}) },
  beforeEach: () =>
    mocked(cookies).mockResolvedValue({
      // @ts-expect-error
      get: (n: string) =>
        n === "last_login_provider" ? { value: "credentials" } : undefined,
    }),
};
