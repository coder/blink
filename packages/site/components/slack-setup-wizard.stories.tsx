import Client from "@blink.so/api";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { useState } from "react";
import { withFetch } from "@/.storybook/utils";
import {
  SlackSetupWizard,
  type SlackSetupWizardInitialState,
} from "./slack-setup-wizard";

const TEST_AGENT_ID = "test-agent-123";
const TEST_WEBHOOK_URL = "https://api.blink.so/webhooks/slack/test-webhook-id";

// Create a client that will have its fetch calls intercepted by withFetch
const mockClient = new Client();

// Create a mock API response helper
const createMockFetchDecorator = (options?: {
  validationValid?: boolean;
  validationError?: string;
  dmReceived?: boolean;
  signatureFailed?: boolean;
  completeSuccess?: boolean;
}) => {
  const {
    validationValid = true,
    validationError,
    dmReceived = false,
    signatureFailed = false,
    completeSuccess = true,
  } = options ?? {};

  return withFetch((url, init) => {
    // GET /api/agents/{agentId}/setup/slack/webhook-url
    if (
      url.pathname.includes("/setup/slack/webhook-url") &&
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

    // POST /api/agents/{agentId}/setup/slack/start-verification
    if (
      url.pathname.includes("/setup/slack/start-verification") &&
      init?.method === "POST"
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

    // GET /api/agents/{agentId}/setup/slack/verification-status
    if (
      url.pathname.includes("/setup/slack/verification-status") &&
      (!init?.method || init.method === "GET")
    ) {
      return new Response(
        JSON.stringify({
          active: true,
          started_at: new Date().toISOString(),
          last_event_at: dmReceived ? new Date().toISOString() : undefined,
          dm_received: dmReceived,
          dm_channel: dmReceived ? "D12345678" : undefined,
          signature_failed: signatureFailed,
          signature_failed_at: signatureFailed
            ? new Date().toISOString()
            : undefined,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // POST /api/onboarding/validate-credentials
    if (
      url.pathname.includes("/onboarding/validate-credentials") &&
      init?.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          valid: validationValid,
          error: validationError,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // POST /api/agents/{agentId}/setup/slack/complete-verification
    if (
      url.pathname.includes("/setup/slack/complete-verification") &&
      init?.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          success: completeSuccess,
          bot_name: "Test Bot",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // POST /api/agents/{agentId}/setup/slack/cancel-verification
    if (
      url.pathname.includes("/setup/slack/cancel-verification") &&
      init?.method === "POST"
    ) {
      return new Response(null, { status: 204 });
    }

    return undefined;
  });
};

const meta: Meta<typeof SlackSetupWizard> = {
  title: "Components/SlackSetupWizard",
  component: SlackSetupWizard,
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
      <SlackSetupWizard {...args} client={mockClient} />
    </div>
  ),
  decorators: [createMockFetchDecorator()],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Helper to create stories with specific initial state
const withInitialState = (state: SlackSetupWizardInitialState): Story => ({
  args: {
    initialState: state,
  },
});

// =============================================================================
// STEP 1: App Name
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

// =============================================================================
// STEP 2: Create Slack App
// =============================================================================

export const Step2_LoadingWebhookUrl: Story = withInitialState({
  webhookUrl: null,
  loadingWebhookUrl: true,
  appName: "Scout",
});
Step2_LoadingWebhookUrl.storyName = "Step 2: Loading Webhook URL";

export const Step2_CreateSlackApp: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: false,
});
Step2_CreateSlackApp.storyName = "Step 2: Create Slack App";

export const Step2_SlackOpened: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
});
Step2_SlackOpened.storyName = "Step 2: Slack Opened (can open again)";

// =============================================================================
// STEP 3: App ID
// =============================================================================

export const Step3_AppId: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "",
});
Step3_AppId.storyName = "Step 3: App ID (empty)";

export const Step3_AppIdFilled: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
});
Step3_AppIdFilled.storyName = "Step 3: App ID (filled)";

// =============================================================================
// STEP 4: Signing Secret
// =============================================================================

export const Step4_SigningSecret: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "",
});
Step4_SigningSecret.storyName = "Step 4: Signing Secret (empty)";

export const Step4_SigningSecretFilled: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
});
Step4_SigningSecretFilled.storyName = "Step 4: Signing Secret (filled)";

// =============================================================================
// STEP 5: Bot Token
// =============================================================================

export const Step5_BotToken: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "",
});
Step5_BotToken.storyName = "Step 5: Bot Token (empty)";

export const Step5_BotTokenFilled: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "xoxb-123456789-abcdefghijklmnop",
});
Step5_BotTokenFilled.storyName = "Step 5: Bot Token (filled, not validated)";

export const Step5_BotTokenValidating: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "xoxb-123456789-abcdefghijklmnop",
  validatingToken: true,
});
Step5_BotTokenValidating.storyName = "Step 5: Bot Token (validating)";

export const Step5_BotTokenValidated: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "xoxb-123456789-abcdefghijklmnop",
  tokenValidated: true,
});
Step5_BotTokenValidated.storyName = "Step 5: Bot Token (validated)";

// =============================================================================
// STEP 6: DM Verification
// =============================================================================

export const Step6_WaitingForDM: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "xoxb-123456789-abcdefghijklmnop",
  tokenValidated: true,
  verificationStarted: true,
  dmReceived: false,
});
Step6_WaitingForDM.storyName = "Step 6: Waiting for DM";

export const Step6_DMReceived: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "xoxb-123456789-abcdefghijklmnop",
  tokenValidated: true,
  verificationStarted: true,
  dmReceived: true,
});
Step6_DMReceived.storyName = "Step 6: DM Received (ready to complete)";

export const Step6_Completing: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "abc123secret",
  botToken: "xoxb-123456789-abcdefghijklmnop",
  tokenValidated: true,
  verificationStarted: true,
  dmReceived: true,
  completing: true,
});
Step6_Completing.storyName = "Step 6: Completing Setup";

export const Step6_SigningSecretError: Story = withInitialState({
  webhookUrl: TEST_WEBHOOK_URL,
  loadingWebhookUrl: false,
  appName: "Scout",
  hasOpenedSlack: true,
  appId: "A0123456789",
  signingSecret: "wrong-secret",
  signingSecretError: true,
  botToken: "xoxb-123456789-abcdefghijklmnop",
  tokenValidated: true,
  verificationStarted: true,
  dmReceived: true,
});
Step6_SigningSecretError.storyName = "Step 6: Signing Secret Error";

// =============================================================================
// OTHER VARIATIONS
// =============================================================================

export const WithoutBackButton: Story = {
  args: {
    onBack: undefined,
    initialState: {
      webhookUrl: TEST_WEBHOOK_URL,
      loadingWebhookUrl: false,
      appName: "Scout",
    },
  },
};
WithoutBackButton.storyName = "Without Back Button";

// Global settings that the fetch mock can read
const interactiveSettings = {
  botTokenValid: true,
  signingSecretValid: true,
  pollCount: 0,
};

// Interactive wrapper component with controls
function InteractiveFlowWrapper() {
  const [botTokenValid, setBotTokenValid] = useState(true);
  const [signingSecretValid, setSigningSecretValid] = useState(true);
  const [key, setKey] = useState(0);

  // Update global settings when state changes
  interactiveSettings.botTokenValid = botTokenValid;
  interactiveSettings.signingSecretValid = signingSecretValid;

  const resetWizard = () => {
    interactiveSettings.pollCount = 0;
    setKey((k) => k + 1);
  };

  return (
    <div className="flex gap-6">
      <div className="w-[600px]">
        <SlackSetupWizard
          key={key}
          client={mockClient}
          agentId={TEST_AGENT_ID}
          agentName="Scout"
          onComplete={fn()}
          onCancel={fn()}
          onBack={fn()}
          onSkip={fn()}
        />
      </div>
      <div className="w-[250px] space-y-4 p-4 border rounded-lg bg-muted/50">
        <h3 className="font-semibold text-sm">Test Controls</h3>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={botTokenValid}
              onChange={(e) => setBotTokenValid(e.target.checked)}
              className="rounded"
            />
            Bot token validation passes
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={signingSecretValid}
              onChange={(e) => setSigningSecretValid(e.target.checked)}
              className="rounded"
            />
            Signing secret verification passes
          </label>
        </div>

        <hr className="border-border" />

        <button
          type="button"
          onClick={resetWizard}
          className="w-full px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
        >
          Reset Wizard
        </button>

        <p className="text-xs text-muted-foreground">
          Toggle the checkboxes to simulate different API responses. The wizard will use these settings for validation and verification.
        </p>
      </div>
    </div>
  );
}

// Interactive story that simulates the full flow with controls
export const InteractiveFlow: Story = {
  render: () => <InteractiveFlowWrapper />,
  decorators: [
    withFetch((url, init) => {
      // Get webhook URL
      if (
        url.pathname.includes("/setup/slack/webhook-url") &&
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

      // Start verification
      if (
        url.pathname.includes("/setup/slack/start-verification") &&
        init?.method === "POST"
      ) {
        interactiveSettings.pollCount = 0; // Reset poll count when starting verification
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

      // Verification status - simulate DM being received after 3 polls
      if (
        url.pathname.includes("/setup/slack/verification-status") &&
        (!init?.method || init.method === "GET")
      ) {
        interactiveSettings.pollCount++;
        const dmReceived = interactiveSettings.pollCount >= 3;
        const signatureFailed = dmReceived && !interactiveSettings.signingSecretValid;
        return new Response(
          JSON.stringify({
            active: true,
            started_at: new Date().toISOString(),
            last_event_at:
              interactiveSettings.pollCount > 1 ? new Date().toISOString() : undefined,
            dm_received: dmReceived,
            dm_channel: dmReceived ? "D12345678" : undefined,
            signature_failed: signatureFailed,
            signature_failed_at: signatureFailed ? new Date().toISOString() : undefined,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Validate credentials (bot token)
      if (
        url.pathname.includes("/onboarding/validate-credentials") &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            valid: interactiveSettings.botTokenValid,
            error: interactiveSettings.botTokenValid ? undefined : "Invalid bot token",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Complete verification
      if (
        url.pathname.includes("/setup/slack/complete-verification") &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            success: true,
            bot_name: "Scout Bot",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Cancel verification
      if (
        url.pathname.includes("/setup/slack/cancel-verification") &&
        init?.method === "POST"
      ) {
        return new Response(null, { status: 204 });
      }

      return undefined;
    }),
  ],
};
InteractiveFlow.storyName = "Interactive Flow";
