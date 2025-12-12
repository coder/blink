import Client from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { withFetch } from "@/.storybook/utils";
import {
  GitHubSetupWizard,
  type GitHubSetupWizardInitialState,
} from "./github-setup-wizard";

const TEST_AGENT_ID = "test-agent-123";
const TEST_WEBHOOK_URL = "https://api.example.com/api/webhook/test-id/github";
const TEST_MANIFEST_URL = "https://github.com/settings/apps/new?manifest=...";
const TEST_SESSION_ID = "test-session-456";

const mockClient = new Client();

const createMockFetchDecorator = (options?: {
  creationStatus?: "pending" | "completed" | "failed" | "expired";
  completeSuccess?: boolean;
  appData?: {
    id: number;
    name: string;
    html_url: string;
    slug: string;
  };
}) => {
  const {
    creationStatus = "pending",
    completeSuccess = true,
    appData = {
      id: 12345,
      name: "Test GitHub App",
      html_url: "https://github.com/apps/test-github-app",
      slug: "test-github-app",
    },
  } = options ?? {};

  return withFetch((url, init) => {
    // GET /api/agents/{agentId}/setup/github/webhook-url
    if (
      url.pathname.includes("/setup/github/webhook-url") &&
      (!init?.method || init.method === "GET")
    ) {
      return new Response(
        JSON.stringify({
          webhook_url: TEST_WEBHOOK_URL,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // POST /api/agents/{agentId}/setup/github/start-creation
    if (
      url.pathname.includes("/setup/github/start-creation") &&
      init?.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          manifest_url: TEST_MANIFEST_URL,
          session_id: TEST_SESSION_ID,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // GET /api/agents/{agentId}/setup/github/creation-status/{sessionId}
    if (
      url.pathname.includes("/setup/github/creation-status") &&
      (!init?.method || init.method === "GET")
    ) {
      return new Response(
        JSON.stringify({
          status: creationStatus,
          app_data: creationStatus === "completed" ? appData : undefined,
          error: creationStatus === "failed" ? "Something went wrong" : undefined,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // POST /api/agents/{agentId}/setup/github/complete-creation
    if (
      url.pathname.includes("/setup/github/complete-creation") &&
      init?.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          success: completeSuccess,
          app_name: appData.name,
          app_url: appData.html_url,
          install_url: `${appData.html_url}/installations/new`,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // POST /api/agents/{agentId}/setup/github/cancel-creation
    if (
      url.pathname.includes("/setup/github/cancel-creation") &&
      init?.method === "POST"
    ) {
      return new Response(null, { status: 204 });
    }

    return undefined;
  });
};

const meta: Meta<typeof GitHubSetupWizard> = {
  title: "Components/GitHubSetupWizard",
  component: GitHubSetupWizard,
  parameters: {
    layout: "centered",
  },
  args: {
    agentId: TEST_AGENT_ID,
    agentName: "Scout",
    onComplete: fn(),
    onCancel: fn(),
    onBack: fn(),
    onSkip: fn(),
  },
  render: (args) => (
    <div className="w-[600px]">
      <GitHubSetupWizard {...args} client={mockClient} />
    </div>
  ),
  decorators: [createMockFetchDecorator()],
};

export default meta;
type Story = StoryObj<typeof meta>;

const withInitialState = (state: GitHubSetupWizardInitialState): Story => ({
  args: {
    initialState: state,
  },
});

// =============================================================================
// STEP 1: App Name & Organization
// =============================================================================

export const Step1_AppName: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "",
});
Step1_AppName.storyName = "Step 1: App Name (empty)";

export const Step1_AppNameFilled: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
});
Step1_AppNameFilled.storyName = "Step 1: App Name (filled)";

export const Step1_WithOrganization: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  organization: "my-org",
});
Step1_WithOrganization.storyName = "Step 1: With Organization";

// =============================================================================
// STEP 2: Create GitHub App
// =============================================================================

export const Step2_LoadingWebhookUrl: Story = withInitialState({
  webhookUrl: null,
  loadingWebhookUrl: true,
  appName: "Scout",
});
Step2_LoadingWebhookUrl.storyName = "Step 2: Loading Webhook URL";

export const Step2_Ready: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedGitHub: false,
});
Step2_Ready.storyName = "Step 2: Ready to Create";

export const Step2_Opened: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedGitHub: true,
  sessionId: TEST_SESSION_ID,
  manifestUrl: TEST_MANIFEST_URL,
});
Step2_Opened.storyName = "Step 2: GitHub Opened";

// =============================================================================
// STEP 3: Waiting for Callback
// =============================================================================

export const Step3_Pending: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedGitHub: true,
  sessionId: TEST_SESSION_ID,
  manifestUrl: TEST_MANIFEST_URL,
  creationStatus: "pending",
});
Step3_Pending.storyName = "Step 3: Waiting for GitHub";

// =============================================================================
// STEP 4: Completed or Failed
// =============================================================================

export const Step4_Completed: Story = {
  ...withInitialState({
    webhookUrl: TEST_WEBHOOK_URL,
    loadingWebhookUrl: false,
    appName: "Scout",
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestUrl: TEST_MANIFEST_URL,
    creationStatus: "completed",
    appData: {
      id: 12345,
      name: "Scout",
      html_url: "https://github.com/apps/scout",
      slug: "scout",
    },
  }),
  decorators: [createMockFetchDecorator({ creationStatus: "completed" })],
};
Step4_Completed.storyName = "Step 4: Completed";

export const Step4_Failed: Story = {
  ...withInitialState({
    webhookUrl: TEST_WEBHOOK_URL,
    loadingWebhookUrl: false,
    appName: "Scout",
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestUrl: TEST_MANIFEST_URL,
    creationStatus: "failed",
    error: "GitHub API error: 422 Unprocessable Entity",
  }),
  decorators: [createMockFetchDecorator({ creationStatus: "failed" })],
};
Step4_Failed.storyName = "Step 4: Failed";

export const Step4_Expired: Story = {
  ...withInitialState({
    webhookUrl: TEST_WEBHOOK_URL,
    loadingWebhookUrl: false,
    appName: "Scout",
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestUrl: TEST_MANIFEST_URL,
    creationStatus: "expired",
  }),
  decorators: [createMockFetchDecorator({ creationStatus: "expired" })],
};
Step4_Expired.storyName = "Step 4: Expired";

// =============================================================================
// Special States
// =============================================================================

export const Completing: Story = {
  ...withInitialState({
    webhookUrl: TEST_WEBHOOK_URL,
    loadingWebhookUrl: false,
    appName: "Scout",
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestUrl: TEST_MANIFEST_URL,
    creationStatus: "completed",
    appData: {
      id: 12345,
      name: "Scout",
      html_url: "https://github.com/apps/scout",
      slug: "scout",
    },
    completing: true,
  }),
  decorators: [createMockFetchDecorator({ creationStatus: "completed" })],
};
Completing.storyName = "Completing Setup";
