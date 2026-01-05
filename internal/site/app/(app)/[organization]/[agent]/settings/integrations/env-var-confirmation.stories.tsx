import type { Meta, StoryObj } from "@storybook/react";
import { Key, Search } from "lucide-react";
import { useState } from "react";
import { fn } from "storybook/test";
import { GitHubIcon } from "@/components/icons/github";
import { SlackIcon } from "@/components/slack-icon";
import { type EnvVarConfig, EnvVarConfirmation } from "./env-var-confirmation";

// Wrapper component that manages state
function StatefulEnvVarConfirmation({
  initialEnvVars,
  ...props
}: Omit<
  React.ComponentProps<typeof EnvVarConfirmation>,
  "envVars" | "onEnvVarsChange"
> & {
  initialEnvVars: EnvVarConfig[];
}) {
  const [envVars, setEnvVars] = useState<EnvVarConfig[]>(initialEnvVars);
  return (
    <EnvVarConfirmation
      {...props}
      envVars={envVars}
      onEnvVarsChange={setEnvVars}
    />
  );
}

const meta: Meta<typeof StatefulEnvVarConfirmation> = {
  title: "Settings/Integrations/EnvVarConfirmation",
  component: StatefulEnvVarConfirmation,
  parameters: {
    layout: "centered",
  },
  args: {
    onSave: fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }),
    onCancel: fn(),
    onBack: fn(),
    saving: false,
  },
  render: (args) => (
    <div className="w-[600px]">
      <StatefulEnvVarConfirmation {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof meta>;

export const LLM_SingleKey: Story = {
  args: {
    title: "LLM API Key",
    description: "Save your LLM API key as an environment variable",
    icon: <Key className="h-5 w-5 text-white" />,
    iconBgColor: "bg-amber-500",
    initialEnvVars: [
      {
        defaultKey: "ANTHROPIC_API_KEY",
        currentKey: "ANTHROPIC_API_KEY",
        value: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789",
        secret: true,
      },
    ],
  },
};
LLM_SingleKey.storyName = "LLM - Single API Key";

export const WebSearch_SingleKey: Story = {
  args: {
    title: "Web Search (Exa)",
    description: "Save your Exa API key as an environment variable",
    icon: <Search className="h-5 w-5 text-white" />,
    iconBgColor: "bg-blue-500",
    initialEnvVars: [
      {
        defaultKey: "EXA_API_KEY",
        currentKey: "EXA_API_KEY",
        value: "exa-12345678-abcd-efgh-ijkl-mnopqrstuvwx",
        secret: true,
      },
    ],
  },
};
WebSearch_SingleKey.storyName = "Web Search - Single API Key";

export const GitHub_MultipleKeys: Story = {
  args: {
    title: "GitHub App",
    description: "Save your GitHub App credentials as environment variables",
    icon: <GitHubIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#24292f]",
    initialEnvVars: [
      {
        defaultKey: "GITHUB_APP_ID",
        currentKey: "GITHUB_APP_ID",
        value: "123456",
        secret: false,
      },
      {
        defaultKey: "GITHUB_CLIENT_ID",
        currentKey: "GITHUB_CLIENT_ID",
        value: "Iv1.abc123def456ghi7",
        secret: false,
      },
      {
        defaultKey: "GITHUB_CLIENT_SECRET",
        currentKey: "GITHUB_CLIENT_SECRET",
        value: "abcdef1234567890abcdef1234567890abcdef12",
        secret: true,
      },
      {
        defaultKey: "GITHUB_WEBHOOK_SECRET",
        currentKey: "GITHUB_WEBHOOK_SECRET",
        value: "webhook-secret-12345",
        secret: true,
      },
      {
        defaultKey: "GITHUB_PRIVATE_KEY",
        currentKey: "GITHUB_PRIVATE_KEY",
        value:
          "LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFcEFJQkFBS0NBUUVBdGVzdC...",
        secret: true,
      },
    ],
  },
};
GitHub_MultipleKeys.storyName = "GitHub - Multiple Credentials";

export const Slack_TwoKeys: Story = {
  args: {
    title: "Slack",
    description: "Save your Slack credentials as environment variables",
    icon: <SlackIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#4A154B]",
    initialEnvVars: [
      {
        defaultKey: "SLACK_BOT_TOKEN",
        currentKey: "SLACK_BOT_TOKEN",
        value: "xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx",
        secret: true,
      },
      {
        defaultKey: "SLACK_SIGNING_SECRET",
        currentKey: "SLACK_SIGNING_SECRET",
        value: "abcdef1234567890abcdef1234567890",
        secret: true,
      },
    ],
  },
};
Slack_TwoKeys.storyName = "Slack - Two Credentials";

export const Saving: Story = {
  args: {
    title: "LLM API Key",
    description: "Save your LLM API key as an environment variable",
    icon: <Key className="h-5 w-5 text-white" />,
    iconBgColor: "bg-amber-500",
    saving: true,
    initialEnvVars: [
      {
        defaultKey: "ANTHROPIC_API_KEY",
        currentKey: "ANTHROPIC_API_KEY",
        value: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789",
        secret: true,
      },
    ],
  },
};
Saving.storyName = "Saving State";

export const WithoutBackButton: Story = {
  args: {
    title: "LLM API Key",
    description: "Save your LLM API key as an environment variable",
    icon: <Key className="h-5 w-5 text-white" />,
    iconBgColor: "bg-amber-500",
    onBack: undefined,
    initialEnvVars: [
      {
        defaultKey: "ANTHROPIC_API_KEY",
        currentKey: "ANTHROPIC_API_KEY",
        value: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789",
        secret: true,
      },
    ],
  },
};
WithoutBackButton.storyName = "Without Back Button";

export const EmptyKeyName: Story = {
  args: {
    title: "LLM API Key",
    description: "Save your LLM API key as an environment variable",
    icon: <Key className="h-5 w-5 text-white" />,
    iconBgColor: "bg-amber-500",
    initialEnvVars: [
      {
        defaultKey: "ANTHROPIC_API_KEY",
        currentKey: "",
        value: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789",
        secret: true,
      },
    ],
  },
};
EmptyKeyName.storyName = "Validation - Empty Key Name";

export const DuplicateKeyNames: Story = {
  args: {
    title: "Slack",
    description: "Save your Slack credentials as environment variables",
    icon: <SlackIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#4A154B]",
    initialEnvVars: [
      {
        defaultKey: "SLACK_BOT_TOKEN",
        currentKey: "SLACK_TOKEN",
        value: "xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx",
        secret: true,
      },
      {
        defaultKey: "SLACK_SIGNING_SECRET",
        currentKey: "SLACK_TOKEN",
        value: "abcdef1234567890abcdef1234567890",
        secret: true,
      },
    ],
  },
};
DuplicateKeyNames.storyName = "Validation - Duplicate Key Names";

export const EditedKeyNames: Story = {
  args: {
    title: "GitHub App",
    description: "Save your GitHub App credentials as environment variables",
    icon: <GitHubIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#24292f]",
    initialEnvVars: [
      {
        defaultKey: "GITHUB_APP_ID",
        currentKey: "MY_GH_APP_ID",
        value: "123456",
        secret: false,
      },
      {
        defaultKey: "GITHUB_CLIENT_ID",
        currentKey: "MY_GH_CLIENT_ID",
        value: "Iv1.abc123def456ghi7",
        secret: false,
      },
      {
        defaultKey: "GITHUB_CLIENT_SECRET",
        currentKey: "MY_GH_CLIENT_SECRET",
        value: "abcdef1234567890abcdef1234567890abcdef12",
        secret: true,
      },
    ],
  },
};
EditedKeyNames.storyName = "Edited Key Names";
