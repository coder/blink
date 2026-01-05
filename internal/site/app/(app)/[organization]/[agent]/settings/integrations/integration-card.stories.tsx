import type { Meta, StoryObj } from "@storybook/react";
import { Key, Search } from "lucide-react";
import { fn } from "storybook/test";
import { GitHubIcon } from "@/components/icons/github";
import { SlackIcon } from "@/components/slack-icon";
import { IntegrationCard } from "./integration-card";

const meta: Meta<typeof IntegrationCard> = {
  title: "Settings/Integrations/IntegrationCard",
  component: IntegrationCard,
  parameters: {
    layout: "centered",
  },
  args: {
    onConfigure: fn(),
  },
  render: (args) => (
    <div className="w-[500px]">
      <IntegrationCard {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof meta>;

export const LLM_NotConfigured: Story = {
  args: {
    title: "LLM API Key",
    description: "Configure an API key for AI capabilities",
    icon: <Key className="h-5 w-5 text-white" />,
    iconBgColor: "bg-amber-500",
    configured: false,
  },
};
LLM_NotConfigured.storyName = "LLM - Not Configured";

export const WebSearch_NotConfigured: Story = {
  args: {
    title: "Web Search (Exa)",
    description: "Enable web search capabilities",
    icon: <Search className="h-5 w-5 text-white" />,
    iconBgColor: "bg-blue-500",
    configured: false,
  },
};
WebSearch_NotConfigured.storyName = "Web Search - Not Configured";

export const GitHub_NotConfigured: Story = {
  args: {
    title: "GitHub",
    description: "Connect to GitHub repositories",
    icon: <GitHubIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#24292f]",
    configured: false,
  },
};
GitHub_NotConfigured.storyName = "GitHub - Not Configured";

export const Slack_NotConfigured: Story = {
  args: {
    title: "Slack",
    description: "Chat with your agent in Slack",
    icon: <SlackIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#4A154B]",
    configured: false,
  },
};
Slack_NotConfigured.storyName = "Slack - Not Configured";

export const LLM_Configured: Story = {
  args: {
    title: "LLM API Key",
    description: "Configure an API key for AI capabilities",
    icon: <Key className="h-5 w-5 text-white" />,
    iconBgColor: "bg-amber-500",
    configured: true,
  },
};
LLM_Configured.storyName = "LLM - Configured";

export const WebSearch_Configured: Story = {
  args: {
    title: "Web Search (Exa)",
    description: "Enable web search capabilities",
    icon: <Search className="h-5 w-5 text-white" />,
    iconBgColor: "bg-blue-500",
    configured: true,
  },
};
WebSearch_Configured.storyName = "Web Search - Configured";

export const GitHub_Configured: Story = {
  args: {
    title: "GitHub",
    description: "Connect to GitHub repositories",
    icon: <GitHubIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#24292f]",
    configured: true,
  },
};
GitHub_Configured.storyName = "GitHub - Configured";

export const Slack_Configured: Story = {
  args: {
    title: "Slack",
    description: "Chat with your agent in Slack",
    icon: <SlackIcon className="h-5 w-5 text-white" />,
    iconBgColor: "bg-[#4A154B]",
    configured: true,
  },
};
Slack_Configured.storyName = "Slack - Configured";
