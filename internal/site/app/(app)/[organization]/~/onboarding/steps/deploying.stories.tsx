import type { Meta, StoryObj } from "@storybook/react";
import { withMockClient } from "@/lib/api-client.mock";
import { DeployingStep } from "./deploying";

const noop = () => {};

const meta: Meta<typeof DeployingStep> = {
  title: "Onboarding/DeployingStep",
  component: DeployingStep,
  parameters: {
    layout: "centered",
  },
  args: {
    organizationId: "org-123",
    agentId: "agent-456",
    goToStep: noop,
    onSuccess: noop,
  },
  decorators: [
    withMockClient(),
    (Story) => (
      <div className="w-[600px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SummaryEmpty: Story = {
  args: {
    initialStatus: "summary",
  },
};

export const SummaryAllConfigured: Story = {
  args: {
    initialStatus: "summary",
    llm: {
      provider: "anthropic",
      apiKey: "sk-ant-xxx",
    },
    webSearch: {
      provider: "exa",
      apiKey: "exa-xxx",
    },
    github: {
      appName: "Scout",
      appUrl: "https://github.com/apps/scout",
      installUrl: "https://github.com/apps/scout/installations/new",
    },
    slack: {
      botToken: "xoxb-xxx",
      signingSecret: "xxx",
    },
  },
};

export const SummaryPartial: Story = {
  args: {
    initialStatus: "summary",
    llm: {
      provider: "openai",
      apiKey: "sk-xxx",
    },
    github: {
      appName: "MyApp",
      appUrl: "https://github.com/apps/myapp",
      installUrl: "https://github.com/apps/myapp/installations/new",
    },
  },
};

export const Deploying: Story = {
  args: {
    initialStatus: "deploying",
  },
};

export const ErrorState: Story = {
  args: {
    initialStatus: "error",
  },
};
