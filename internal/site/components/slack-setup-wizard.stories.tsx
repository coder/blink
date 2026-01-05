import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { fn } from "storybook/test";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import {
  SlackSetupWizard,
  type SlackSetupWizardInitialState,
} from "./slack-setup-wizard";

const TEST_AGENT_ID = "test-agent-123";
const TEST_WEBHOOK_URL = "https://api.blink.so/webhooks/slack/test-webhook-id";

interface MockOptions {
  validationValid?: boolean;
  validationError?: string;
  dmReceived?: boolean;
  signatureFailed?: boolean;
  completeSuccess?: boolean;
}

function configureMockClient(client: MockedClient, options?: MockOptions) {
  const {
    validationValid = true,
    validationError,
    dmReceived = false,
    signatureFailed = false,
    completeSuccess = true,
  } = options ?? {};

  client.agents.setupSlack.getWebhookUrl.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });

  client.agents.setupSlack.startVerification.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });

  client.agents.setupSlack.getVerificationStatus.mockResolvedValue({
    active: true,
    started_at: new Date().toISOString(),
    last_event_at: dmReceived ? new Date().toISOString() : undefined,
    dm_received: dmReceived,
    dm_channel: dmReceived ? "D12345678" : undefined,
    signature_failed: signatureFailed,
    signature_failed_at: signatureFailed ? new Date().toISOString() : undefined,
  });

  client.agents.setupSlack.validateToken.mockResolvedValue({
    valid: validationValid,
    error: validationError,
  });

  client.agents.setupSlack.completeVerification.mockResolvedValue({
    success: completeSuccess,
    bot_name: "Test Bot",
  });

  client.agents.setupSlack.cancelVerification.mockResolvedValue(undefined);
}

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
    onBack: fn(),
    onSkip: fn(),
  },
  render: (args) => (
    <div className="w-[600px]">
      <SlackSetupWizard {...args} />
    </div>
  ),
  decorators: [withMockClient((client) => configureMockClient(client))],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Helper to create stories with specific initial state
const withInitialState = (state: SlackSetupWizardInitialState): Story => ({
  args: {
    initialState: state,
  },
});

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

// Global settings that the mock client can read
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
          agentId={TEST_AGENT_ID}
          agentName="Scout"
          onComplete={fn()}
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
          Toggle the checkboxes to simulate different API responses. The wizard
          will use these settings for validation and verification.
        </p>
      </div>
    </div>
  );
}

// Configure interactive mock client with dynamic behavior
function configureInteractiveMockClient(client: MockedClient) {
  client.agents.setupSlack.getWebhookUrl.mockResolvedValue({
    webhook_url: TEST_WEBHOOK_URL,
  });

  client.agents.setupSlack.startVerification.mockImplementation(() => {
    interactiveSettings.pollCount = 0;
    return Promise.resolve({ webhook_url: TEST_WEBHOOK_URL });
  });

  client.agents.setupSlack.getVerificationStatus.mockImplementation(() => {
    interactiveSettings.pollCount++;
    const dmReceived = interactiveSettings.pollCount >= 3;
    const signatureFailed =
      dmReceived && !interactiveSettings.signingSecretValid;
    return Promise.resolve({
      active: true,
      started_at: new Date().toISOString(),
      last_event_at:
        interactiveSettings.pollCount > 1
          ? new Date().toISOString()
          : undefined,
      dm_received: dmReceived,
      dm_channel: dmReceived ? "D12345678" : undefined,
      signature_failed: signatureFailed,
      signature_failed_at: signatureFailed
        ? new Date().toISOString()
        : undefined,
    });
  });

  client.agents.setupSlack.validateToken.mockImplementation(() =>
    Promise.resolve({
      valid: interactiveSettings.botTokenValid,
      error: interactiveSettings.botTokenValid
        ? undefined
        : "Invalid bot token",
    })
  );

  client.agents.setupSlack.completeVerification.mockResolvedValue({
    success: true,
    bot_name: "Scout Bot",
  });

  client.agents.setupSlack.cancelVerification.mockResolvedValue(undefined);
}

// Interactive story that simulates the full flow with controls
export const InteractiveFlow: Story = {
  render: () => <InteractiveFlowWrapper />,
  decorators: [withMockClient(configureInteractiveMockClient)],
};
InteractiveFlow.storyName = "Interactive Flow";
