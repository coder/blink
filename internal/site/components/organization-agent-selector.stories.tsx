import type { Agent, Organization } from "@blink.so/api";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react";
import { type MockedClient, withMockClient } from "@/lib/api-client.mock";
import AgentSelector from "./organization-agent-selector";

const mockOrganizations: Organization[] = [
  {
    id: "1",
    name: "Personal",
    kind: "personal",
    avatar_url: null,
    created_at: new Date(),
    updated_at: new Date(),
    membership: {
      user_id: "user-1",
      organization_id: "1",
      role: "owner",
      created_at: new Date(),
      updated_at: new Date(),
    },
    members_url: "/api/organizations/1/members",
    invites_url: "/api/organizations/1/invites",
  },
  {
    id: "2",
    name: "Coder",
    kind: "organization",
    avatar_url: "https://avatars.githubusercontent.com/u/95932066",
    created_at: new Date(),
    updated_at: new Date(),
    membership: {
      user_id: "user-1",
      organization_id: "2",
      role: "admin",
      created_at: new Date(),
      updated_at: new Date(),
    },
    members_url: "/api/organizations/2/members",
    invites_url: "/api/organizations/2/invites",
  },
  {
    id: "3",
    name: "Acme Corp",
    kind: "organization",
    avatar_url: null,
    created_at: new Date(),
    updated_at: new Date(),
    membership: {
      user_id: "user-1",
      organization_id: "3",
      role: "member",
      created_at: new Date(),
      updated_at: new Date(),
    },
    members_url: "/api/organizations/3/members",
    invites_url: "/api/organizations/3/invites",
  },
];

const mockAgents: Agent[] = [
  {
    id: "agent-1",
    organization_id: "2",
    name: "Scout",
    description: "A helpful assistant for your team",
    avatar_url: null,
    visibility: "organization",
    pinned: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "user-1",
    chat_expire_ttl: null,
    active_deployment_id: null,
    request_url: null,
    onboarding_state: null,
    integrations_state: null,
  },
  {
    id: "agent-2",
    organization_id: "2",
    name: "Weather Bot",
    description: "Get weather updates and forecasts",
    avatar_url: null,
    visibility: "organization",
    pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "user-1",
    chat_expire_ttl: null,
    active_deployment_id: null,
    request_url: null,
    onboarding_state: null,
    integrations_state: null,
  },
  {
    id: "agent-3",
    organization_id: "2",
    name: "Code Review",
    description: "Automated code review assistant",
    avatar_url: null,
    visibility: "organization",
    pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "user-1",
    chat_expire_ttl: null,
    active_deployment_id: null,
    request_url: null,
    onboarding_state: null,
    integrations_state: null,
  },
];

function configureMockClient(client: MockedClient) {
  client.organizations.list.mockResolvedValue(mockOrganizations);
  client.agents.list.mockResolvedValue({
    items: mockAgents,
    has_more: false,
  });
}

const meta: Meta<typeof AgentSelector> = {
  title: "Components/OrganizationAgentSelector",
  component: AgentSelector,
  parameters: {
    layout: "centered",
  },
  decorators: [withMockClient(configureMockClient)],
  render: (args) => (
    <DropdownMenuPrimitive.Root open modal={false}>
      <DropdownMenuPrimitive.Trigger asChild>
        <button type="button" className="sr-only">
          Open
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Content
        forceMount
        className="z-50"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <AgentSelector {...args} />
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Root>
  ),
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithSelectedOrganization: Story = {
  args: {
    selectedOrganization: mockOrganizations[1],
  },
};

export const WithSelectedAgent: Story = {
  args: {
    selectedOrganization: mockOrganizations[1],
    selectedAgent: mockAgents[0],
  },
};

export const MultiOrgDisabled: Story = {
  args: {
    enableMultiOrg: false,
  },
};

export const MultiOrgDisabledWithSelection: Story = {
  args: {
    enableMultiOrg: false,
    selectedOrganization: mockOrganizations[1],
  },
};

export const EmptyOrganizations: Story = {
  decorators: [
    withMockClient((client) => {
      client.organizations.list.mockResolvedValue([]);
      client.agents.list.mockResolvedValue({
        items: [],
        has_more: false,
      });
    }),
  ],
};

export const EmptyAgents: Story = {
  decorators: [
    withMockClient((client) => {
      client.organizations.list.mockResolvedValue(mockOrganizations);
      client.agents.list.mockResolvedValue({
        items: [],
        has_more: false,
      });
    }),
  ],
};

export const LoadingState: Story = {
  decorators: [
    withMockClient((client) => {
      client.organizations.list.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      client.agents.list.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
    }),
  ],
};

export const ErrorState: Story = {
  decorators: [
    withMockClient((client) => {
      client.organizations.list.mockRejectedValue(
        new Error("Failed to load organizations")
      );
      client.agents.list.mockRejectedValue(new Error("Failed to load agents"));
    }),
  ],
};
