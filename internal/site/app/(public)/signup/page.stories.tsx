import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import { mocked } from "storybook/test";
import Layout from "@/app/(public)/layout";
import {
  type AuthProvider,
  defaultAuthProviders,
  getAuthProviders,
} from "@/lib/auth-providers.mock";
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

export const Default: Story = {
  args: {},
};

export const OAuthEnabled: Story = {
  args: {},
  decorators: [
    withProviders({
      credentials: {
        id: "credentials",
        name: "Credentials",
        type: "credentials",
      },
      github: {
        id: "github",
        name: "GitHub",
        type: "oauth",
      },
      google: {
        id: "google",
        name: "Google",
        type: "oauth",
      },
    }),
  ],
};

export const OAuthDisabled: Story = {
  args: {},
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

// Add Early Access variant
export const EarlyAccess: Story = {
  args: {
    searchParams: Promise.resolve({ ["early-access"]: "" } as any),
  },
};
