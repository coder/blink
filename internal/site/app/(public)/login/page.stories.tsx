import Layout from "@/app/(public)/layout";
import { cookies } from "@storybook/nextjs-vite/headers.mock";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import { mocked } from "storybook/test";
import {
  type AuthProvider,
  defaultAuthProviders,
  getAuthProviders,
} from "@/lib/auth-providers.mock";
import {
  getPublicSignupStatus,
  type PublicSignupStatus,
} from "@/lib/signups.mock";
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

const withProviders =
  (providers: Record<string, AuthProvider>) => (Story: any) => {
    mocked(getAuthProviders).mockResolvedValue(providers);

    useEffect(() => {
      return () => {
        mocked(getAuthProviders).mockResolvedValue(defaultAuthProviders);
      };
    }, []);

    return <Story />;
  };

const withSignupStatus = (status: PublicSignupStatus) => (Story: any) => {
  mocked(getPublicSignupStatus).mockResolvedValue(status);

  useEffect(() => {
    return () => {
      mocked(getPublicSignupStatus).mockResolvedValue({
        enableSignups: true,
        isFirstUser: false,
        allowPublicSignups: true,
      });
    };
  }, []);

  return <Story />;
};

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

export const OAuthDisabled: Story = {
  args: { searchParams: Promise.resolve({}) },
  decorators: [
    withProviders({
      credentials: {
        id: "credentials",
        name: "Credentials",
        type: "credentials",
      },
    }),
  ],
};

export const SignupsDisabled: Story = {
  args: { searchParams: Promise.resolve({}) },
  decorators: [
    withSignupStatus({
      enableSignups: false,
      isFirstUser: false,
      allowPublicSignups: false,
    }),
  ],
};

export const SignupsAndOAuthDisabled: Story = {
  args: { searchParams: Promise.resolve({}) },
  decorators: [
    withProviders({
      credentials: {
        id: "credentials",
        name: "Credentials",
        type: "credentials",
      },
    }),
    withSignupStatus({
      enableSignups: false,
      isFirstUser: false,
      allowPublicSignups: false,
    }),
  ],
};
