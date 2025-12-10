import type { Meta, StoryObj } from "@storybook/react";
import { withFetch } from "@/.storybook/utils";
import Client from "@blink.so/api";
import { OnboardingWizard, type OnboardingState } from "./wizard";

const TEST_ORGANIZATION_ID = "org-123";
const TEST_ORGANIZATION_NAME = "test-org";
const TEST_AGENT_ID = "agent-456";
const TEST_FILE_ID = "file-789";
const TEST_WEBHOOK_URL = "https://api.blink.so/webhooks/slack/test-webhook-id";

// Create a mock client for stories
const mockClient = new Client({ baseURL: "http://localhost:6006" });

// Track state across mocked API calls
const mockState = {
  pollCount: 0,
};

// Create comprehensive fetch mock for all onboarding API calls
const createMockFetchDecorator = () => {
  return withFetch((url, init) => {
    const method = init?.method || "GET";

    // POST /api/onboarding/download-agent
    if (
      url.pathname.includes("/onboarding/download-agent") &&
      method === "POST"
    ) {
      return new Response(JSON.stringify({ file_id: TEST_FILE_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /api/agents (create agent)
    if (url.pathname === "/api/agents" && method === "POST") {
      return new Response(
        JSON.stringify({
          id: TEST_AGENT_ID,
          name: "scout",
          description:
            "AI agent with GitHub, Slack, and web search integrations",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // POST /api/onboarding/validate-credentials
    if (
      url.pathname.includes("/onboarding/validate-credentials") &&
      method === "POST"
    ) {
      return new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/agents/{agentId}/setup/slack/webhook-url
    if (url.pathname.includes("/setup/slack/webhook-url") && method === "GET") {
      return new Response(JSON.stringify({ webhook_url: TEST_WEBHOOK_URL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /api/agents/{agentId}/setup/slack/start-verification
    if (
      url.pathname.includes("/setup/slack/start-verification") &&
      method === "POST"
    ) {
      mockState.pollCount = 0;
      return new Response(JSON.stringify({ webhook_url: TEST_WEBHOOK_URL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/agents/{agentId}/setup/slack/verification-status
    if (
      url.pathname.includes("/setup/slack/verification-status") &&
      method === "GET"
    ) {
      mockState.pollCount++;
      const dmReceived = mockState.pollCount >= 3;
      return new Response(
        JSON.stringify({
          active: true,
          started_at: new Date().toISOString(),
          last_event_at:
            mockState.pollCount > 1 ? new Date().toISOString() : undefined,
          dm_received: dmReceived,
          dm_channel: dmReceived ? "D12345678" : undefined,
          signature_failed: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // POST /api/agents/{agentId}/setup/slack/complete-verification
    if (
      url.pathname.includes("/setup/slack/complete-verification") &&
      method === "POST"
    ) {
      return new Response(
        JSON.stringify({ success: true, bot_name: "Scout Bot" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // POST /api/agents/{agentId}/setup/slack/cancel-verification
    if (
      url.pathname.includes("/setup/slack/cancel-verification") &&
      method === "POST"
    ) {
      return new Response(null, { status: 204 });
    }

    // POST /api/agents/{agentId}/env (create env variable)
    if (url.pathname.includes("/env") && method === "POST") {
      return new Response(
        JSON.stringify({ id: "env-123", key: "TEST_KEY", secret: false }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // POST /api/agents/{agentId}/deployments (create deployment)
    if (url.pathname.includes("/deployments") && method === "POST") {
      return new Response(
        JSON.stringify({ id: "deployment-123", status: "success" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return undefined;
  });
};

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
    client: mockClient,
  },
  decorators: [
    createMockFetchDecorator(),
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Base state for steps that need an existing agent
const withAgentState: Partial<OnboardingState> = {
  agentName: "Scout",
  agentId: TEST_AGENT_ID,
  fileId: TEST_FILE_ID,
};

// =============================================================================
// FULL FLOW
// =============================================================================

export const FullFlow: Story = {};
FullFlow.storyName = "Full Flow (from Welcome)";

// =============================================================================
// INDIVIDUAL STEPS
// =============================================================================

export const Step1_Welcome: Story = {
  args: {
    initialState: {
      currentStep: "welcome",
    },
  },
};
Step1_Welcome.storyName = "Step 1: Welcome";

export const Step2_GitHubSetup: Story = {
  args: {
    initialState: {
      ...withAgentState,
      currentStep: "github-setup",
    },
  },
};
Step2_GitHubSetup.storyName = "Step 2: GitHub Setup";

export const Step3_SlackSetup: Story = {
  args: {
    initialState: {
      ...withAgentState,
      currentStep: "slack-setup",
    },
  },
};
Step3_SlackSetup.storyName = "Step 3: Slack Setup";

export const Step4_ApiKeys: Story = {
  args: {
    initialState: {
      ...withAgentState,
      currentStep: "api-keys",
    },
  },
};
Step4_ApiKeys.storyName = "Step 4: API Keys";

export const Step5_Deploying: Story = {
  args: {
    initialState: {
      ...withAgentState,
      currentStep: "deploying",
    },
  },
};
Step5_Deploying.storyName = "Step 5: Deploying";

export const Step6_Success: Story = {
  args: {
    initialState: {
      ...withAgentState,
      currentStep: "success",
    },
  },
};
Step6_Success.storyName = "Step 6: Success";
