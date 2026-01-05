import type { Agent } from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { PageContainer } from "@/components/page-header";
import {
  SettingsNavigation,
  type SettingsTab,
} from "@/components/settings-navigation";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import { AgentDeleteForm } from "./agent-delete-form";
import { AgentSettingsForm } from "./form";
import IntegrationsManager from "./integrations/integrations-manager";
import { WebhooksSection } from "./webhooks/webhooks-section";

const TEST_AGENT_ID = "test-agent-123";
const TEST_ORGANIZATION_NAME = "acme";
const TEST_AGENT_NAME = "scout";
const TEST_WEBHOOK_URL = "https://api.blink.so/webhooks/test-webhook-id";
const TEST_GITHUB_URL = "https://github.com/settings/apps/new";
const TEST_MANIFEST = JSON.stringify({
  name: "Test App",
  url: "https://blink.so",
});
const TEST_SESSION_ID = "test-session-456";

// Mock agent data
const mockAgent: Agent = {
  id: TEST_AGENT_ID,
  organization_id: "org-123",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by: "user-123",
  name: TEST_AGENT_NAME,
  description: "An AI-powered code review assistant.",
  avatar_url: null,
  visibility: "organization",
  active_deployment_id: "deploy-123",
  pinned: false,
  request_url: "https://api.blink.so/agents/test-agent-123/request",
  chat_expire_ttl: null,
  onboarding_state: null,
  integrations_state: null,
};

// Configure mock client for general settings
function configureMockClient(client: MockedClient) {
  client.agents.update.mockResolvedValue({
    ...mockAgent,
    updated_at: new Date().toISOString(),
  });
  client.agents.delete.mockResolvedValue(undefined);
}

// Configure mock client for integrations tab
function configureIntegrationsMockClient(client: MockedClient) {
  // Slack mocks
  client.agents.setupSlack.getWebhookUrl.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });
  client.agents.setupSlack.startVerification.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });
  client.agents.setupSlack.getVerificationStatus.mockResolvedValue({
    active: true,
    started_at: new Date().toISOString(),
    last_event_at: undefined,
    dm_received: false,
    dm_channel: undefined,
    signature_failed: false,
  });
  client.agents.setupSlack.completeVerification.mockResolvedValue({
    success: true,
    bot_name: "Test Bot",
  });
  client.agents.setupSlack.cancelVerification.mockResolvedValue(undefined);
  client.agents.setupSlack.validateToken.mockResolvedValue({
    valid: true,
    error: undefined,
  });

  // GitHub mocks
  client.agents.setupGitHub.startCreation.mockResolvedValue({
    manifest: TEST_MANIFEST,
    github_url: TEST_GITHUB_URL,
    session_id: TEST_SESSION_ID,
  });
  client.agents.setupGitHub.getCreationStatus.mockResolvedValue({
    status: "pending",
    app_data: undefined,
    credentials: undefined,
    error: undefined,
  });
  client.agents.setupGitHub.completeCreation.mockResolvedValue({
    success: true,
    app_name: "Test GitHub App",
    app_url: "https://github.com/apps/test-github-app",
    install_url: "https://github.com/apps/test-github-app/installations/new",
  });

  // Environment variables mock
  client.agents.env.create.mockResolvedValue({
    id: "env-123",
    created_at: new Date(),
    updated_at: new Date(),
    created_by: "user-123",
    updated_by: "user-123",
    key: "TEST_KEY",
    value: "test-value",
    secret: true,
    target: ["preview", "production"],
  });
  client.agents.updateOnboarding.mockResolvedValue({
    id: TEST_AGENT_ID,
    organization_id: "org-123",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "user-123",
    name: "Scout",
    description: null,
    avatar_url: null,
    visibility: "organization",
    active_deployment_id: null,
    pinned: false,
    request_url: null,
    chat_expire_ttl: null,
    onboarding_state: null,
    integrations_state: null,
  });
}

// Mock navigation component with configurable active tab
function MockSettingsNav({ activeTab }: { activeTab: string }) {
  const baseHref = `/${TEST_ORGANIZATION_NAME}/${TEST_AGENT_NAME}/settings`;

  const tabs: SettingsTab[] = [
    { value: "general", label: "General", href: baseHref },
    {
      value: "environment",
      label: "Environment Variables",
      href: `${baseHref}/env`,
    },
    {
      value: "integrations",
      label: "Integrations",
      href: `${baseHref}/integrations`,
    },
    { value: "webhooks", label: "Webhooks", href: `${baseHref}/webhooks` },
  ];

  return (
    <SettingsNavigation
      title="Settings"
      tabs={tabs}
      getActiveTab={() => activeTab}
    />
  );
}

// General settings tab content
function GeneralTabContent({ agent }: { agent: Agent }) {
  return (
    <PageContainer>
      <MockSettingsNav activeTab="general" />
      <div className="space-y-8">
        <AgentSettingsForm
          agent={agent}
          organizationName={TEST_ORGANIZATION_NAME}
          agentName={TEST_AGENT_NAME}
        />
        <AgentDeleteForm
          agentId={agent.id}
          agentName={agent.name}
          organizationName={TEST_ORGANIZATION_NAME}
        />
      </div>
    </PageContainer>
  );
}

// Integrations tab content
function IntegrationsTabContent({ agent }: { agent: Agent }) {
  return (
    <PageContainer>
      <MockSettingsNav activeTab="integrations" />
      <IntegrationsManager
        agentId={agent.id}
        agentName={agent.name}
        integrationsState={agent.integrations_state}
      />
    </PageContainer>
  );
}

// Webhooks tab content
function WebhooksTabContent({ agent }: { agent: Agent }) {
  return (
    <PageContainer>
      <MockSettingsNav activeTab="webhooks" />
      <WebhooksSection
        agent={agent}
        organizationName={TEST_ORGANIZATION_NAME}
        agentName={TEST_AGENT_NAME}
      />
    </PageContainer>
  );
}

const meta: Meta = {
  title: "Settings/AgentSettings",
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: `/${TEST_ORGANIZATION_NAME}/${TEST_AGENT_NAME}/settings`,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const General: Story = {
  render: () => <GeneralTabContent agent={mockAgent} />,
  decorators: [withMockClient(configureMockClient)],
};

export const Integrations: Story = {
  render: () => <IntegrationsTabContent agent={mockAgent} />,
  decorators: [withMockClient(configureIntegrationsMockClient)],
};

export const IntegrationsConfigured: Story = {
  render: () => (
    <IntegrationsTabContent
      agent={{
        ...mockAgent,
        onboarding_state: {
          currentStep: "success",
          llm: { apiKey: "sk-ant-***", provider: "anthropic" },
          webSearch: { apiKey: "exa-***", provider: "exa" },
          github: {
            appId: 12345,
            appName: "acme-scout",
            appUrl: "https://github.com/apps/acme-scout",
            installUrl: "https://github.com/apps/acme-scout/installations/new",
          },
          slack: { botToken: "xoxb-***", signingSecret: "***" },
        },
      }}
    />
  ),
  decorators: [withMockClient(configureIntegrationsMockClient)],
};
IntegrationsConfigured.storyName = "Integrations (Configured)";

export const Webhooks: Story = {
  render: () => <WebhooksTabContent agent={mockAgent} />,
  decorators: [withMockClient(configureMockClient)],
};

export const WebhooksNotDeployed: Story = {
  render: () => (
    <WebhooksTabContent
      agent={{
        ...mockAgent,
        request_url: null,
        active_deployment_id: null,
      }}
    />
  ),
  decorators: [withMockClient(configureMockClient)],
};
WebhooksNotDeployed.storyName = "Webhooks (Not Deployed)";
