import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import {
  GitHubSetupWizard,
  type GitHubSetupWizardInitialState,
} from "./github-setup-wizard";

const TEST_AGENT_ID = "test-agent-123";
const TEST_GITHUB_URL = "https://github.com/settings/apps/new";
const TEST_MANIFEST = JSON.stringify({
  name: "Test App",
  url: "https://blink.so",
});
const TEST_SESSION_ID = "test-session-456";

interface MockOptions {
  creationStatus?:
    | "pending"
    | "app_created"
    | "completed"
    | "failed"
    | "expired";
  completeSuccess?: boolean;
  appData?: {
    id: number;
    name: string;
    html_url: string;
    slug: string;
  };
}

function configureMockClient(client: MockedClient, options?: MockOptions) {
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

  client.agents.setupGitHub.startCreation.mockResolvedValue({
    manifest: TEST_MANIFEST,
    github_url: TEST_GITHUB_URL,
    session_id: TEST_SESSION_ID,
  });

  client.agents.setupGitHub.getCreationStatus.mockResolvedValue({
    status: creationStatus,
    app_data:
      creationStatus === "completed" || creationStatus === "app_created"
        ? appData
        : undefined,
    credentials:
      creationStatus === "completed"
        ? {
            app_id: appData.id,
            client_id: "Iv1.test123",
            client_secret: "test-client-secret",
            webhook_secret: "test-webhook-secret",
            private_key: btoa("test-private-key"),
          }
        : undefined,
    error: creationStatus === "failed" ? "Something went wrong" : undefined,
  });

  client.agents.setupGitHub.completeCreation.mockResolvedValue({
    success: completeSuccess,
    app_name: appData.name,
    app_url: appData.html_url,
    install_url: `${appData.html_url}/installations/new`,
  });
}

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
    onBack: fn(),
    onSkip: fn(),
  },
  render: (args) => (
    <div className="w-[600px]">
      <GitHubSetupWizard {...args} />
    </div>
  ),
  decorators: [withMockClient((client) => configureMockClient(client))],
};

export default meta;
type Story = StoryObj<typeof meta>;

const withInitialState = (state: GitHubSetupWizardInitialState): Story => ({
  args: {
    initialState: state,
  },
});

export const Initial: Story = withInitialState({});
Initial.storyName = "Initial";

export const WithOrganization: Story = withInitialState({
  organization: "my-github-org",
});
WithOrganization.storyName = "With Organization";

export const WaitingForAppCreation: Story = withInitialState({
  hasOpenedGitHub: true,
  sessionId: TEST_SESSION_ID,
  manifestData: { manifest: TEST_MANIFEST, github_url: TEST_GITHUB_URL },
  creationStatus: "pending",
});
WaitingForAppCreation.storyName = "Waiting for App Creation";

export const WaitingForInstallation: Story = {
  ...withInitialState({
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestData: { manifest: TEST_MANIFEST, github_url: TEST_GITHUB_URL },
    creationStatus: "app_created",
    appData: {
      id: 12345,
      name: "my-org-Scout",
      html_url: "https://github.com/apps/my-org-scout",
      slug: "my-org-scout",
    },
  }),
  decorators: [
    withMockClient((client) =>
      configureMockClient(client, { creationStatus: "app_created" })
    ),
  ],
};
WaitingForInstallation.storyName = "Waiting for Installation";

export const Completed: Story = {
  ...withInitialState({
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestData: { manifest: TEST_MANIFEST, github_url: TEST_GITHUB_URL },
    creationStatus: "completed",
    appData: {
      id: 12345,
      name: "my-org-Scout",
      html_url: "https://github.com/apps/my-org-scout",
      slug: "my-org-scout",
    },
    credentials: {
      appId: 12345,
      clientId: "Iv1.test123",
      clientSecret: "test-client-secret",
      webhookSecret: "test-webhook-secret",
      privateKey: btoa("test-private-key"),
    },
  }),
  decorators: [
    withMockClient((client) =>
      configureMockClient(client, { creationStatus: "completed" })
    ),
  ],
};
Completed.storyName = "Completed";

export const Failed: Story = {
  ...withInitialState({
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestData: { manifest: TEST_MANIFEST, github_url: TEST_GITHUB_URL },
    creationStatus: "failed",
    error: "GitHub API error: 422 Unprocessable Entity",
  }),
  decorators: [
    withMockClient((client) =>
      configureMockClient(client, { creationStatus: "failed" })
    ),
  ],
};
Failed.storyName = "Failed";

export const Expired: Story = {
  ...withInitialState({
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestData: { manifest: TEST_MANIFEST, github_url: TEST_GITHUB_URL },
    creationStatus: "expired",
  }),
  decorators: [
    withMockClient((client) =>
      configureMockClient(client, { creationStatus: "expired" })
    ),
  ],
};
Expired.storyName = "Expired";

export const Completing: Story = {
  ...withInitialState({
    hasOpenedGitHub: true,
    sessionId: TEST_SESSION_ID,
    manifestData: { manifest: TEST_MANIFEST, github_url: TEST_GITHUB_URL },
    creationStatus: "completed",
    appData: {
      id: 12345,
      name: "my-org-Scout",
      html_url: "https://github.com/apps/my-org-scout",
      slug: "my-org-scout",
    },
    credentials: {
      appId: 12345,
      clientId: "Iv1.test123",
      clientSecret: "test-client-secret",
      webhookSecret: "test-webhook-secret",
      privateKey: btoa("test-private-key"),
    },
    completing: true,
  }),
  decorators: [
    withMockClient((client) =>
      configureMockClient(client, { creationStatus: "completed" })
    ),
  ],
};
Completing.storyName = "Completing";
