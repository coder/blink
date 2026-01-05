import type { Meta, StoryObj } from "@storybook/react";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import { type AgentInfo, OnboardingWizard } from "./wizard";

const TEST_ORGANIZATION_ID = "org-123";
const TEST_ORGANIZATION_NAME = "test-org";
const TEST_AGENT_ID = "agent-456";
const TEST_FILE_ID = "file-789";
const TEST_WEBHOOK_URL = "https://api.blink.so/webhooks/slack/test-webhook-id";
const TEST_GITHUB_SESSION_ID = "github-session-123";
const TEST_GITHUB_MANIFEST_URL =
  "https://github.com/settings/apps/new?manifest=...";

// Track state across mocked API calls
const mockState = {
  pollCount: 0,
  githubPollCount: 0,
};

function configureMockClient(
  client: MockedClient,
  options?: { hangDeployment?: boolean }
) {
  const { hangDeployment = false } = options || {};

  // Download agent
  client.onboarding.downloadAgent.mockResolvedValue({
    output_files: [{ path: "main.js", id: TEST_FILE_ID }],
    source_files: [{ path: "index.ts", id: "src-file-123" }],
    entrypoint: "main.js",
  });

  // Create agent
  client.agents.create.mockResolvedValue({
    id: TEST_AGENT_ID,
    organization_id: TEST_ORGANIZATION_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "user-123",
    name: "blink",
    description: "AI agent with GitHub, Slack, and web search integrations",
    avatar_url: null,
    visibility: "organization",
    active_deployment_id: null,
    pinned: false,
    request_url: null,
    chat_expire_ttl: null,
    onboarding_state: { currentStep: "welcome" },
    integrations_state: null,
  });

  // Validate Slack token
  client.agents.setupSlack.validateToken.mockResolvedValue({
    valid: true,
  });

  // GitHub setup
  client.agents.setupGitHub.startCreation.mockImplementation(() => {
    mockState.githubPollCount = 0;
    return Promise.resolve({
      manifest_url: TEST_GITHUB_MANIFEST_URL,
      manifest: "{}",
      github_url: TEST_GITHUB_MANIFEST_URL,
      session_id: TEST_GITHUB_SESSION_ID,
    });
  });

  client.agents.setupGitHub.getCreationStatus.mockImplementation(() => {
    mockState.githubPollCount++;
    const completed = mockState.githubPollCount >= 3;
    return Promise.resolve({
      status: completed ? "completed" : "pending",
      app_data: completed
        ? {
            id: 12345,
            name: "Scout",
            html_url: "https://github.com/apps/scout",
            slug: "scout",
          }
        : undefined,
      credentials: completed
        ? {
            app_id: 12345,
            client_id: "test-client-id",
            client_secret: "test-client-secret",
            webhook_secret: "test-webhook-secret",
            private_key: btoa("test-private-key"),
          }
        : undefined,
    });
  });

  client.agents.setupGitHub.completeCreation.mockResolvedValue({
    success: true,
    app_name: "Scout",
    app_url: "https://github.com/apps/scout",
    install_url: "https://github.com/apps/scout/installations/new",
  });

  // Slack setup
  client.agents.setupSlack.getWebhookUrl.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });

  client.agents.setupSlack.startVerification.mockImplementation(() => {
    mockState.pollCount = 0;
    return Promise.resolve({ webhook_url: TEST_WEBHOOK_URL });
  });

  client.agents.setupSlack.getVerificationStatus.mockImplementation(() => {
    mockState.pollCount++;
    const dmReceived = mockState.pollCount >= 3;
    return Promise.resolve({
      active: true,
      started_at: new Date().toISOString(),
      last_event_at:
        mockState.pollCount > 1 ? new Date().toISOString() : undefined,
      dm_received: dmReceived,
      dm_channel: dmReceived ? "D12345678" : undefined,
      signature_failed: false,
    });
  });

  client.agents.setupSlack.completeVerification.mockResolvedValue({
    success: true,
    bot_name: "Scout Bot",
  });

  client.agents.setupSlack.cancelVerification.mockResolvedValue(undefined);

  // Environment variables
  client.agents.env.create.mockResolvedValue({
    id: "env-123",
    created_at: new Date(),
    updated_at: new Date(),
    created_by: "user-123",
    updated_by: "user-123",
    key: "TEST_KEY",
    value: "test-value",
    secret: false,
    target: ["preview", "production"],
  });

  // Deployments
  if (hangDeployment) {
    client.agents.deployments.create.mockImplementation(
      () => new Promise(() => {})
    );
  } else {
    client.agents.deployments.create.mockResolvedValue({
      id: "deployment-123",
      agent_id: TEST_AGENT_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: "user-123",
      created_from: "cli",
      status: "success",
      number: 1,
      source_files: [{ path: "index.ts", id: "src-file-123" }],
      output_files: [{ path: "main.js", id: TEST_FILE_ID }],
      target: "production",
      error_message: null,
      user_message: null,
      platform: "lambda",
      platform_memory_mb: 512,
      platform_region: null,
    });
  }

  // Update onboarding
  client.agents.updateOnboarding.mockResolvedValue({
    id: TEST_AGENT_ID,
    organization_id: TEST_ORGANIZATION_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "user-123",
    name: "blink",
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

const meta: Meta<typeof OnboardingWizard> = {
  title: "Onboarding/OnboardingWizard",
  component: OnboardingWizard,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: {
        push: () => {},
      },
    },
  },
  args: {
    organizationId: TEST_ORGANIZATION_ID,
    organizationName: TEST_ORGANIZATION_NAME,
  },
  decorators: [
    withMockClient((client) => configureMockClient(client)),
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Base agent for steps that need an existing agent
const baseAgent: AgentInfo = {
  id: TEST_AGENT_ID,
  name: "blink",
  onboarding_state: { currentStep: "welcome", finished: false },
};

export const FullFlow: Story = {};
FullFlow.storyName = "Full Flow (from Welcome)";

export const Step1_Welcome: Story = {};
Step1_Welcome.storyName = "Step 1: Welcome";

export const Step2_LlmApiKeys: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: { currentStep: "llm-api-keys", finished: false },
    },
  },
};
Step2_LlmApiKeys.storyName = "Step 2: LLM API Keys";

export const Step3_GitHubSetup: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: { currentStep: "github-setup", finished: false },
    },
  },
};
Step3_GitHubSetup.storyName = "Step 3: GitHub Setup";

export const Step4_SlackSetup: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: { currentStep: "slack-setup", finished: false },
    },
  },
};
Step4_SlackSetup.storyName = "Step 4: Slack Setup";

export const Step5_WebSearch: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: { currentStep: "web-search", finished: false },
    },
  },
};
Step5_WebSearch.storyName = "Step 5: Web Search";

export const Step6_Summary_Empty: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: { currentStep: "deploying", finished: false },
    },
  },
};
Step6_Summary_Empty.storyName = "Step 6: Summary (Nothing Configured)";

export const Step6_Summary_AllConfigured: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: {
        currentStep: "deploying",
        finished: false,
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
    },
  },
};
Step6_Summary_AllConfigured.storyName = "Step 6: Summary (All Configured)";

export const Step6_Summary_Partial: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: {
        currentStep: "deploying",
        finished: false,
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
    },
  },
};
Step6_Summary_Partial.storyName = "Step 6: Summary (Partial Config)";

export const Step7_Success: Story = {
  args: {
    agent: {
      ...baseAgent,
      onboarding_state: { currentStep: "success", finished: false },
    },
  },
};
Step7_Success.storyName = "Step 7: Success";
