import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import IntegrationsManager from "./integrations-manager";

const TEST_AGENT_ID = "test-agent-123";
const TEST_WEBHOOK_URL = "https://api.blink.so/webhooks/test-webhook-id";
const TEST_GITHUB_URL = "https://github.com/settings/apps/new";
const TEST_MANIFEST = JSON.stringify({
  name: "Test App",
  url: "https://blink.so",
});
const TEST_SESSION_ID = "test-session-456";

// Configure mock client with default responses for all integrations
interface MockOptions {
  // Slack options
  slackValidationValid?: boolean;
  slackDmReceived?: boolean;
  slackSignatureFailed?: boolean;
  // GitHub options
  githubCreationStatus?:
    | "pending"
    | "app_created"
    | "completed"
    | "failed"
    | "expired";
  githubAppData?: {
    id: number;
    name: string;
    html_url: string;
    slug: string;
  };
}

// Configure mock client with default responses for all integrations
function configureMockClient(client: MockedClient, options?: MockOptions) {
  const {
    slackValidationValid = true,
    slackDmReceived = false,
    slackSignatureFailed = false,
    githubCreationStatus = "pending",
    githubAppData = {
      id: 12345,
      name: "Test GitHub App",
      html_url: "https://github.com/apps/test-github-app",
      slug: "test-github-app",
    },
  } = options ?? {};

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
    last_event_at: slackDmReceived ? new Date().toISOString() : undefined,
    dm_received: slackDmReceived,
    dm_channel: slackDmReceived ? "D12345678" : undefined,
    signature_failed: slackSignatureFailed,
  });
  client.agents.setupSlack.completeVerification.mockResolvedValue({
    success: true,
    bot_name: "Test Bot",
  });
  client.agents.setupSlack.cancelVerification.mockResolvedValue(undefined);
  client.agents.setupSlack.validateToken.mockResolvedValue({
    valid: slackValidationValid,
    error: slackValidationValid ? undefined : "Invalid token",
  });

  // GitHub mocks
  client.agents.setupGitHub.startCreation.mockResolvedValue({
    manifest: TEST_MANIFEST,
    github_url: TEST_GITHUB_URL,
    session_id: TEST_SESSION_ID,
  });
  client.agents.setupGitHub.getCreationStatus.mockResolvedValue({
    status: githubCreationStatus,
    app_data:
      githubCreationStatus === "completed" ||
      githubCreationStatus === "app_created"
        ? githubAppData
        : undefined,
    credentials:
      githubCreationStatus === "completed"
        ? {
            app_id: githubAppData.id,
            client_id: "Iv1.test123",
            client_secret: "test-client-secret",
            webhook_secret: "test-webhook-secret",
            private_key: btoa("test-private-key"),
          }
        : undefined,
    error:
      githubCreationStatus === "failed" ? "Something went wrong" : undefined,
  });
  client.agents.setupGitHub.completeCreation.mockResolvedValue({
    success: true,
    app_name: githubAppData.name,
    app_url: githubAppData.html_url,
    install_url: `${githubAppData.html_url}/installations/new`,
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

const meta: Meta<typeof IntegrationsManager> = {
  title: "Settings/Integrations/IntegrationsManager",
  component: IntegrationsManager,
  parameters: {
    layout: "centered",
  },
  args: {
    agentId: TEST_AGENT_ID,
    agentName: "Scout",
  },
  render: (args) => (
    <div className="w-[600px]">
      <IntegrationsManager {...args} />
    </div>
  ),
  decorators: [withMockClient((client) => configureMockClient(client))],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
Default.storyName = "Default (All Cards)";

// Settings that the mock client can read for dynamic behavior
const interactiveSettings = {
  slackBotTokenValid: true,
  slackSigningSecretValid: true,
  slackPollCount: 0,
  githubPollCount: 0,
};

// Configure interactive mock client with dynamic behavior
function configureInteractiveMockClient(client: MockedClient) {
  // Slack mocks with dynamic behavior
  client.agents.setupSlack.getWebhookUrl.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });
  client.agents.setupSlack.startVerification.mockImplementation(() => {
    interactiveSettings.slackPollCount = 0;
    return Promise.resolve({ webhook_url: TEST_WEBHOOK_URL });
  });
  client.agents.setupSlack.getVerificationStatus.mockImplementation(() => {
    interactiveSettings.slackPollCount++;
    const dmReceived = interactiveSettings.slackPollCount >= 3;
    const signatureFailed =
      dmReceived && !interactiveSettings.slackSigningSecretValid;
    return Promise.resolve({
      active: true,
      started_at: new Date().toISOString(),
      last_event_at:
        interactiveSettings.slackPollCount > 1
          ? new Date().toISOString()
          : undefined,
      dm_received: dmReceived,
      dm_channel: dmReceived ? "D12345678" : undefined,
      signature_failed: signatureFailed,
    });
  });
  client.agents.setupSlack.completeVerification.mockResolvedValue({
    success: true,
    bot_name: "Scout Bot",
  });
  client.agents.setupSlack.cancelVerification.mockResolvedValue(undefined);
  client.agents.setupSlack.validateToken.mockImplementation(() =>
    Promise.resolve({
      valid: interactiveSettings.slackBotTokenValid,
      error: interactiveSettings.slackBotTokenValid
        ? undefined
        : "Invalid bot token",
    })
  );

  // GitHub mocks with auto-progression
  client.agents.setupGitHub.startCreation.mockImplementation(() => {
    interactiveSettings.githubPollCount = 0;
    return Promise.resolve({
      manifest: TEST_MANIFEST,
      github_url: TEST_GITHUB_URL,
      session_id: TEST_SESSION_ID,
    });
  });
  client.agents.setupGitHub.getCreationStatus.mockImplementation(() => {
    interactiveSettings.githubPollCount++;
    let status: "pending" | "app_created" | "completed" = "pending";
    if (interactiveSettings.githubPollCount >= 5) {
      status = "completed";
    } else if (interactiveSettings.githubPollCount >= 3) {
      status = "app_created";
    }

    const appData = {
      id: 12345,
      name: "my-org-Scout",
      html_url: "https://github.com/apps/my-org-scout",
      slug: "my-org-scout",
    };

    return Promise.resolve({
      status,
      app_data: status !== "pending" ? appData : undefined,
      credentials:
        status === "completed"
          ? {
              app_id: appData.id,
              client_id: "Iv1.test123",
              client_secret: "test-client-secret-12345",
              webhook_secret: "test-webhook-secret-67890",
              private_key: btoa(
                "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
              ),
            }
          : undefined,
    });
  });
  client.agents.setupGitHub.completeCreation.mockResolvedValue({
    success: true,
    app_name: "my-org-Scout",
    app_url: "https://github.com/apps/my-org-scout",
    install_url: "https://github.com/apps/my-org-scout/installations/new",
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

function InteractiveFlowWrapper() {
  const [slackBotTokenValid, setSlackBotTokenValid] = useState(true);
  const [slackSigningSecretValid, setSlackSigningSecretValid] = useState(true);
  const [key, setKey] = useState(0);

  // Update global settings when state changes
  interactiveSettings.slackBotTokenValid = slackBotTokenValid;
  interactiveSettings.slackSigningSecretValid = slackSigningSecretValid;

  const resetIntegrations = () => {
    interactiveSettings.slackPollCount = 0;
    interactiveSettings.githubPollCount = 0;
    setKey((k) => k + 1);
  };

  return (
    <div className="flex gap-6">
      <div className="w-[600px]">
        <IntegrationsManager
          key={key}
          agentId={TEST_AGENT_ID}
          agentName="Scout"
          integrationsState={null}
        />
      </div>
      <div className="w-[250px] space-y-4 p-4 border rounded-lg bg-muted/50">
        <h3 className="font-semibold text-sm">Test Controls</h3>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Slack</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={slackBotTokenValid}
              onChange={(e) => setSlackBotTokenValid(e.target.checked)}
              className="rounded"
            />
            Bot token validation passes
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={slackSigningSecretValid}
              onChange={(e) => setSlackSigningSecretValid(e.target.checked)}
              className="rounded"
            />
            Signing secret valid
          </label>
        </div>

        <hr className="border-border" />

        <button
          type="button"
          onClick={resetIntegrations}
          className="w-full px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
        >
          Reset All
        </button>

        <p className="text-xs text-muted-foreground">
          Toggle checkboxes to simulate different API responses. GitHub will
          auto-progress through stages after clicking &quot;Create & install on
          GitHub&quot;.
        </p>
      </div>
    </div>
  );
}

export const InteractiveFlow: Story = {
  render: () => <InteractiveFlowWrapper />,
  decorators: [withMockClient(configureInteractiveMockClient)],
};
InteractiveFlow.storyName = "Interactive Flow";

export const MixedStates: Story = {
  args: {
    integrationsState: {
      llm: true,
      github: true,
    },
  },
};
MixedStates.storyName = "Mixed States (Partial Setup)";

export const AllConfigured: Story = {
  args: {
    integrationsState: {
      llm: true,
      webSearch: true,
      github: true,
      slack: true,
    },
  },
};
AllConfigured.storyName = "All Configured";
