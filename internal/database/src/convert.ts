import type {
  Agent,
  AgentDeployment,
  AgentDeploymentTarget,
  Chat,
  ChatMessage,
  ChatMessageFormat,
  Organization,
  User,
} from "@blink.so/api";
import type {
  AgentWithPinned,
  ChatWithStatusAndAgent,
  Agent as DBAgent,
  AgentDeployment as DBAgentDeployment,
  DBMessage,
  OrganizationWithMembership as DBOrganizationWithMembership,
  UserWithPersonalOrganization,
} from "./schema";
import { computeExpiresAt } from "./shared";

export const organization = (
  baseURL: URL,
  org: DBOrganizationWithMembership
): Organization => {
  return {
    id: org.id,
    created_at: org.created_at,
    updated_at: org.updated_at,
    name: org.name,
    avatar_url: org.avatar_url,
    membership: org.membership
      ? {
          organization_id: org.membership.organization_id,
          user_id: org.membership.user_id,
          role: org.membership.role,
          created_at: org.membership.created_at,
          updated_at: org.membership.updated_at,
        }
      : null,
    members_url: new URL(
      `/api/organizations/${org.id}/members`,
      baseURL
    ).toString(),
    invites_url: new URL(
      `/api/invites?organization_id=${org.id}`,
      baseURL
    ).toString(),
  };
};

export const agent = (
  agent: AgentWithPinned | DBAgent,
  requestURL?: URL,
  userPermission?: "read" | "write" | "admin"
): Agent => {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    visibility: agent.visibility,
    organization_id: agent.organization_id,
    created_at: agent.created_at.toISOString(),
    updated_at: agent.updated_at.toISOString(),
    created_by: agent.created_by,
    avatar_url: agent.avatar_file_id
      ? `/api/files/${agent.avatar_file_id}`
      : null,
    active_deployment_id: agent.active_deployment_id,
    request_url: requestURL?.toString() ?? null,
    pinned: "pinned" in agent ? agent.pinned : false,
    chat_expire_ttl: agent.chat_expire_ttl,
    user_permission: userPermission,
    onboarding_state:
      userPermission === "admin" || userPermission === "write"
        ? (agent.onboarding_state ?? null)
        : null,
    integrations_state:
      userPermission === "admin" || userPermission === "write"
        ? (agent.integrations_state ?? null)
        : null,
  };
};

export const user = (user: UserWithPersonalOrganization): User => {
  return {
    id: user.id,
    created_at: user.created_at,
    updated_at: user.updated_at,
    email: user.email!,
    email_verified: user.email_verified !== null,
    display_name: user.display_name!,
    username: user.username,
    avatar_url: user.avatar_url,
    organization_id: user.organization_id,
  };
};

export const agentDeployment = (
  deployment: DBAgentDeployment & { target: string }
): AgentDeployment => {
  return {
    agent_id: deployment.agent_id,
    id: deployment.id,
    number: deployment.number,
    created_at: deployment.created_at.toISOString(),
    updated_at: deployment.updated_at.toISOString(),
    created_by: deployment.created_by ?? null,
    created_from: deployment.created_from,
    source_files: deployment.source_files || [],
    output_files: deployment.output_files || [],
    status: deployment.status,
    target: deployment.target as AgentDeploymentTarget,
    error_message: deployment.error_message,
    user_message: deployment.user_message,
    platform: deployment.platform as "lambda",
    platform_memory_mb: deployment.platform_memory_mb,
    platform_region: deployment.platform_region,
  };
};

export const message = (
  format: ChatMessageFormat,
  message: DBMessage
): ChatMessage => {
  return {
    id: message.id,
    created_at: message.created_at.toISOString(),
    chat_id: message.chat_id,
    metadata: message.metadata,
    format: format,
    parts: message.parts,
    role: message.role,
  };
};

export const chat = (chat: ChatWithStatusAndAgent): Chat => {
  return {
    id: chat.id,
    archived: chat.archived,
    created_at: chat.created_at.toISOString(),
    updated_at: chat.updated_at.toISOString(),
    created_by: chat.created_by!,
    organization_id: chat.organization_id,
    title: chat.title,
    agent: agent(chat.agent),
    agent_deployment_id: chat.agent_deployment_id,
    visibility: chat.visibility,
    metadata: chat.metadata,
    status: chat.status,
    error: chat.error,
    expire_ttl: chat.expire_ttl,
    expires_at: chat.expire_ttl
      ? (computeExpiresAt(chat.expire_ttl, chat.created_at)?.toISOString() ??
        null)
      : null,
  };
};
