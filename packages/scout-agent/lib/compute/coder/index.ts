import type { Client } from "@blink-sdk/compute-protocol/client";
import { WebSocket } from "ws";
import { z } from "zod";
import type { Logger } from "../../types";
import { newComputeClient } from "../common";

const WorkspaceStatusSchema = z.enum([
  "pending",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
  "canceling",
  "canceled",
  "deleting",
  "deleted",
]);

const AgentStatusSchema = z.enum([
  "connecting",
  "connected",
  "disconnected",
  "timeout",
]);

const WorkspaceAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: AgentStatusSchema,
});

const WorkspaceResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  agents: z.array(WorkspaceAgentSchema).optional(),
});

const WorkspaceBuildSchema = z.object({
  id: z.string(),
  status: WorkspaceStatusSchema,
  resources: z.array(WorkspaceResourceSchema),
});

const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner_name: z.string(),
  template_id: z.string(),
  template_name: z.string(),
  latest_build: WorkspaceBuildSchema,
});

const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  organization_id: z.string(),
  active_version_id: z.string(),
});

const PresetSchema = z.object({
  ID: z.string(),
  Name: z.string(),
  Default: z.boolean(),
  Description: z.string().optional(),
  Icon: z.string().optional(),
});

const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
});

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const AppHostSchema = z.object({
  host: z.string(),
});

const CoderApiErrorSchema = z.object({
  message: z.string(),
  detail: z.string().optional(),
});

// The types below are not inferred from the schemas above due to typescript's isolatedDeclarations feature.

type WorkspaceStatus =
  | "pending"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "canceling"
  | "canceled"
  | "deleting"
  | "deleted";

type WorkspaceTransition = "start" | "stop" | "delete";

type AgentStatus = "connecting" | "connected" | "disconnected" | "timeout";

interface WorkspaceAgent {
  id: string;
  name: string;
  status: AgentStatus;
}

interface WorkspaceResource {
  id: string;
  name: string;
  type: string;
  agents?: WorkspaceAgent[];
}

interface WorkspaceBuild {
  id: string;
  status: WorkspaceStatus;
  resources: WorkspaceResource[];
}

interface Workspace {
  id: string;
  name: string;
  owner_name: string;
  template_id: string;
  template_name: string;
  latest_build: WorkspaceBuild;
}

interface Template {
  id: string;
  name: string;
  organization_id: string;
  active_version_id: string;
}

interface Preset {
  ID: string;
  Name: string;
  Default: boolean;
  Description?: string;
  Icon?: string;
}

interface User {
  id: string;
  username: string;
}

interface Organization {
  id: string;
  name: string;
}

// Request types (not validated, these are what we send)
interface WorkspaceBuildParameter {
  name: string;
  value: string;
}

interface CreateWorkspaceRequest {
  template_id?: string;
  template_version_id?: string;
  name: string;
  rich_parameter_values?: WorkspaceBuildParameter[];
  template_version_preset_id?: string;
}

interface CreateWorkspaceBuildRequest {
  transition: WorkspaceTransition;
  rich_parameter_values?: WorkspaceBuildParameter[];
}

export class CoderApiClient {
  private readonly baseUrl: string;
  readonly sessionToken: string;

  constructor(baseUrl: string, sessionToken: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sessionToken = sessionToken;
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Coder-Session-Token": this.sessionToken,
      Accept: "application/json",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorBody = CoderApiErrorSchema.safeParse(await response.json());
        if (errorBody.success) {
          errorMessage = errorBody.data.message || errorMessage;
          if (errorBody.data.detail) {
            errorMessage += ` - ${errorBody.data.detail}`;
          }
        }
      } catch {
        // Ignore JSON parse errors, use default message
      }
      throw new Error(errorMessage);
    }

    // Handle empty responses (204 No Content, etc.)
    const contentType = response.headers.get("content-type");
    if (response.status === 204 || !contentType?.includes("application/json")) {
      return schema.parse({});
    }

    const json = await response.json();
    return schema.parse(json);
  }

  // Get current authenticated user
  async getMe(): Promise<User> {
    return this.request("GET", "/api/v2/users/me", UserSchema);
  }

  // Get workspace by owner and name
  async getWorkspaceByOwnerAndName(
    owner: string,
    name: string
  ): Promise<Workspace | undefined> {
    try {
      return await this.request(
        "GET",
        `/api/v2/users/${encodeURIComponent(owner)}/workspace/${encodeURIComponent(name)}`,
        WorkspaceSchema
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        return undefined;
      }
      throw err;
    }
  }

  // Get workspace by ID
  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.request(
      "GET",
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`,
      WorkspaceSchema
    );
  }

  // Get template by name in organization
  async getTemplateByName(
    organizationId: string,
    templateName: string
  ): Promise<Template | undefined> {
    try {
      return await this.request(
        "GET",
        `/api/v2/organizations/${encodeURIComponent(organizationId)}/templates/${encodeURIComponent(templateName)}`,
        TemplateSchema
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        return undefined;
      }
      throw err;
    }
  }

  // Get default organization
  async getDefaultOrganization(): Promise<Organization> {
    return this.request(
      "GET",
      "/api/v2/organizations/default",
      OrganizationSchema
    );
  }

  // Create workspace in organization
  async createWorkspace(
    organizationId: string,
    request: CreateWorkspaceRequest
  ): Promise<Workspace> {
    return this.request(
      "POST",
      `/api/v2/organizations/${encodeURIComponent(organizationId)}/members/me/workspaces`,
      WorkspaceSchema,
      request
    );
  }

  // Create a new workspace build (start/stop/delete)
  async createWorkspaceBuild(
    workspaceId: string,
    request: CreateWorkspaceBuildRequest
  ): Promise<WorkspaceBuild> {
    return this.request(
      "POST",
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/builds`,
      WorkspaceBuildSchema,
      request
    );
  }

  // Get the wildcard hostname for workspace applications
  async getAppHost(): Promise<string> {
    const response = await this.request(
      "GET",
      "/api/v2/applications/host",
      AppHostSchema
    );
    // The response is an empty string if no wildcard access URL is configured
    // https://github.com/coder/coder/blob/5d66aa95376d9df46371e2cbb3d6beaf1a0666cf/coderd/workspaceapps.go#L34
    // https://github.com/coder/coder/blob/5d66aa95376d9df46371e2cbb3d6beaf1a0666cf/coderd/workspaceapps/appurl/appurl.go#L42
    if (response.host === "") {
      throw new Error(
        "Coder deployment does not have a wildcard access URL configured. This is required for workspace support. See https://coder.com/docs/admin/networking/wildcard-access-url for configuration instructions."
      );
    }
    return response.host;
  }

  // Get presets for a template version
  async getTemplateVersionPresets(
    templateVersionId: string
  ): Promise<Preset[]> {
    return this.request(
      "GET",
      `/api/v2/templateversions/${encodeURIComponent(templateVersionId)}/presets`,
      z.array(PresetSchema)
    );
  }
}

export interface CoderWorkspaceInfo {
  /** Workspace ID (UUID) */
  workspaceId: string;
  /** Workspace name */
  workspaceName: string;
  /** Owner username */
  ownerName: string;
  /** Agent ID to connect to */
  agentId?: string;
  /** Agent name */
  agentName: string;
}

export interface InitializeCoderWorkspaceOptions {
  /** Coder deployment URL (e.g., https://coder.example.com) */
  coderUrl: string;
  /** Session token for authentication */
  sessionToken: string;
  /** Port the blink compute server will listen on inside the workspace (default: 22137) */
  computeServerPort?: number;
  /** Optional CoderApiClient instance (for testing) */
  client?: CoderApiClient;
  /**
   * Template name to create workspace from.
   * Required if creating a new workspace.
   */
  template?: string;
  /**
   * Workspace name to use. If not provided and no existing workspace,
   * a unique name will be generated.
   */
  workspaceName?: string;
  /**
   * Agent name to connect to. If workspace has multiple agents, this specifies which one.
   * If not provided, uses the first available agent.
   */
  agentName?: string;
  /**
   * Rich template parameters for workspace creation.
   */
  richParameters?: Array<{ name: string; value: string }>;
  /**
   * Preset name for workspace creation. The preset must exist on the template version.
   * Presets provide pre-configured parameter values.
   */
  presetName?: string;
  /**
   * Time to wait for workspace to start (in seconds). Default is 300 (5 minutes).
   */
  startTimeoutSeconds?: number;
  /**
   * Polling interval for workspace status checks in ms (default: 2000).
   * Useful for testing.
   */
  pollingIntervalMs?: number;
  /**
   * Polling interval for compute server reachability checks in ms (default: 3000).
   * Useful for testing.
   */
  computeServerPollingIntervalMs?: number;
}

const COMPUTE_SERVER_PORT = 22137;

/**
 * Extracts agents from workspace resources.
 */
function getAgentsFromWorkspace(workspace: Workspace): WorkspaceAgent[] {
  const agents: WorkspaceAgent[] = [];
  for (const resource of workspace.latest_build.resources || []) {
    for (const agent of resource.agents || []) {
      agents.push(agent);
    }
  }
  return agents;
}

interface WaitForWorkspaceReadyOptions {
  client: CoderApiClient;
  workspaceId: string;
  agentName: string | undefined;
  timeoutSeconds: number;
  computeServerPort: number;
  /** Polling interval in ms (default: 2000) */
  pollingIntervalMs?: number;
  /** Compute server polling interval in ms (default: 3000) */
  computeServerPollingIntervalMs?: number;
  /** Use http:// instead of https:// (for local development) */
  useHttp?: boolean;
}

/**
 * Waits for workspace to be running and agent to be connected.
 */
async function waitForWorkspaceReady(
  opts: WaitForWorkspaceReadyOptions
): Promise<{ workspace: Workspace; agent: WorkspaceAgent }> {
  const { client, workspaceId, agentName, timeoutSeconds } = opts;
  const pollingIntervalMs = opts.pollingIntervalMs ?? 2000;
  const computeServerPollingIntervalMs =
    opts.computeServerPollingIntervalMs ?? 3000;
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;
  const appHostname = await client.getAppHost();

  while (Date.now() - startTime < timeoutMs) {
    const workspace = await client.getWorkspace(workspaceId);
    const status = workspace.latest_build.status;

    if (status === "failed" || status === "canceled" || status === "deleted") {
      throw new Error(
        `Workspace ${workspace.name} is in terminal state: ${status}`
      );
    }

    if (status === "running") {
      const agents = getAgentsFromWorkspace(workspace);
      if (agents.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
        continue;
      }

      // Find the requested agent or use the first one
      const agent = agentName
        ? agents.find((a) => a.name === agentName)
        : agents[0];

      if (!agent) {
        throw new Error(
          `Agent '${agentName}' not found. Available agents: ${agents.map((a) => a.name).join(", ")}`
        );
      }

      if (agent.status === "connected") {
        await ensureComputeServer({
          agentName: agent.name,
          workspaceName: workspace.name,
          ownerName: workspace.owner_name,
          computeServerPort: opts.computeServerPort,
          appHostname: appHostname,
          sessionToken: client.sessionToken,
          pollingIntervalMs: computeServerPollingIntervalMs,
          useHttp: opts.useHttp,
        });
        return { workspace, agent };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  }

  throw new Error(
    `Timeout waiting for workspace to be ready after ${timeoutSeconds} seconds`
  );
}

interface ComputeServerConnectionInfo {
  appHostname: string;
  workspaceName: string;
  ownerName: string;
  agentName: string;
  computeServerPort: number;
  sessionToken: string;
  /** Use http:// instead of https:// (for local development) */
  useHttp?: boolean;
}

/**
 * Checks if the compute server is reachable via the subdomain proxy.
 */
async function isComputeServerReachable(
  opts: ComputeServerConnectionInfo
): Promise<boolean> {
  const {
    appHostname,
    workspaceName,
    ownerName,
    agentName,
    computeServerPort,
    sessionToken,
    useHttp,
  } = opts;
  const appSubdomain = `${computeServerPort}--${agentName}--${workspaceName}--${ownerName}`;
  const appHost = appHostname.replace("*", appSubdomain);
  const protocol = useHttp ? "http" : "https";
  const proxyUrl = `${protocol}://${appHost}/`;

  try {
    const response = await fetch(proxyUrl, {
      method: "GET",
      headers: {
        "Coder-Session-Token": sessionToken,
      },
      signal: AbortSignal.timeout(5000),
    });
    // Any response (even error) from the compute server means it's running
    // The proxy returns 502/503 if the backend is not reachable
    return response.status !== 502 && response.status !== 503;
  } catch {
    return false;
  }
}

interface EnsureComputeServerOptions {
  agentName: string;
  workspaceName: string;
  ownerName: string;
  computeServerPort: number;
  appHostname: string;
  sessionToken: string;
  /** Polling interval in ms (default: 3000) */
  pollingIntervalMs?: number;
  /** Use http:// instead of https:// (for local development) */
  useHttp?: boolean;
}

/**
 * Ensures the blink compute server is running in the workspace.
 * Polls the subdomain proxy until the compute server responds.
 */
async function ensureComputeServer(
  opts: EnsureComputeServerOptions
): Promise<void> {
  const pollingIntervalMs = opts.pollingIntervalMs ?? 3000;
  const connectionInfo: ComputeServerConnectionInfo = {
    appHostname: opts.appHostname,
    workspaceName: opts.workspaceName,
    ownerName: opts.ownerName,
    agentName: opts.agentName,
    computeServerPort: opts.computeServerPort,
    sessionToken: opts.sessionToken,
    useHttp: opts.useHttp,
  };

  // Poll the subdomain proxy until the compute server responds
  const startTime = Date.now();
  const timeout = 120000; // 2 minutes for install + start

  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));

    if (await isComputeServerReachable(connectionInfo)) {
      return;
    }
  }

  throw new Error("Timeout waiting for blink compute server to start");
}

/**
 * Initializes a Coder workspace for use with blink compute.
 */
export const initializeCoderWorkspace = async (
  logger: Logger,
  options: InitializeCoderWorkspaceOptions,
  existingWorkspaceInfo: CoderWorkspaceInfo | undefined
): Promise<{ workspaceInfo: CoderWorkspaceInfo; message: string }> => {
  const client =
    options.client ??
    new CoderApiClient(options.coderUrl, options.sessionToken);
  const computeServerPort = options.computeServerPort || COMPUTE_SERVER_PORT;
  const timeoutSeconds = options.startTimeoutSeconds || 300;

  // Get current user for owner name
  const me = await client.getMe();
  const appHostname = await client.getAppHost();

  // Check if we have an existing workspace
  if (existingWorkspaceInfo) {
    try {
      const workspace = await client.getWorkspace(
        existingWorkspaceInfo.workspaceId
      );
      const status = workspace.latest_build.status;

      if (status === "running") {
        const agents = getAgentsFromWorkspace(workspace);
        const agent = existingWorkspaceInfo.agentName
          ? agents.find((a) => a.name === existingWorkspaceInfo.agentName)
          : agents.find((a) => a.id === existingWorkspaceInfo.agentId) ||
            agents[0];

        if (agent?.status === "connected") {
          // Ensure compute server is running
          await ensureComputeServer({
            agentName: agent.name,
            workspaceName: workspace.name,
            ownerName: workspace.owner_name,
            computeServerPort,
            appHostname,
            sessionToken: options.sessionToken,
            pollingIntervalMs: options.computeServerPollingIntervalMs,
            useHttp: options.coderUrl.startsWith("http://"),
          });

          return {
            workspaceInfo: {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              ownerName: workspace.owner_name,
              agentId: agent.id,
              agentName: agent.name,
            },
            message: `Workspace "${workspace.owner_name}/${workspace.name}" already initialized and running.`,
          };
        }
      }

      if (status === "stopped" || status === "stopping") {
        logger.info(`Starting stopped workspace ${workspace.name}...`);
        await client.createWorkspaceBuild(workspace.id, {
          transition: "start",
        });

        const { workspace: readyWorkspace, agent } =
          await waitForWorkspaceReady({
            client,
            workspaceId: workspace.id,
            agentName: existingWorkspaceInfo.agentName,
            timeoutSeconds,
            computeServerPort,
            pollingIntervalMs: options.pollingIntervalMs,
            computeServerPollingIntervalMs:
              options.computeServerPollingIntervalMs,
            useHttp: options.coderUrl.startsWith("http://"),
          });

        return {
          workspaceInfo: {
            workspaceId: readyWorkspace.id,
            workspaceName: readyWorkspace.name,
            ownerName: readyWorkspace.owner_name,
            agentId: agent.id,
            agentName: agent.name,
          },
          message: `Workspace "${readyWorkspace.owner_name}/${readyWorkspace.name}" started and initialized.`,
        };
      }

      if (status === "starting" || status === "pending") {
        const { workspace: readyWorkspace, agent } =
          await waitForWorkspaceReady({
            client,
            workspaceId: workspace.id,
            agentName: existingWorkspaceInfo.agentName,
            timeoutSeconds,
            computeServerPort,
            pollingIntervalMs: options.pollingIntervalMs,
            computeServerPollingIntervalMs:
              options.computeServerPollingIntervalMs,
            useHttp: options.coderUrl.startsWith("http://"),
          });

        return {
          workspaceInfo: {
            workspaceId: readyWorkspace.id,
            workspaceName: readyWorkspace.name,
            ownerName: readyWorkspace.owner_name,
            agentId: agent.id,
            agentName: agent.name,
          },
          message: `Workspace "${readyWorkspace.owner_name}/${readyWorkspace.name}" initialized.`,
        };
      }
    } catch (err: unknown) {
      logger.warn(
        "Error checking existing Coder workspace, will create a new one instead.",
        err
      );
    }
  }

  // Create a new workspace
  if (!options.template) {
    throw new Error(
      "Template is required to create a new workspace. Please provide the 'template' option."
    );
  }

  // Get default organization and template
  const org = await client.getDefaultOrganization();
  const template = await client.getTemplateByName(org.id, options.template);
  if (!template) {
    throw new Error(
      `Template '${options.template}' not found in organization '${org.name}'`
    );
  }

  // Look up preset if specified
  let presetId: string | undefined;
  if (options.presetName) {
    const presets = await client.getTemplateVersionPresets(
      template.active_version_id
    );
    const preset = presets.find((p) => p.Name === options.presetName);
    if (!preset) {
      const availablePresets = presets.map((p) => p.Name).join(", ");
      throw new Error(
        `Preset '${options.presetName}' not found. Available presets: ${availablePresets || "(none)"}`
      );
    }
    presetId = preset.ID;
  }

  const workspaceName =
    options.workspaceName || `blink-${Date.now().toString(36)}`;

  const workspace = await client.createWorkspace(org.id, {
    template_id: template.id,
    name: workspaceName,
    rich_parameter_values: options.richParameters,
    template_version_preset_id: presetId,
  });

  const { workspace: readyWorkspace, agent } = await waitForWorkspaceReady({
    client,
    workspaceId: workspace.id,
    agentName: options.agentName,
    timeoutSeconds,
    computeServerPort,
    pollingIntervalMs: options.pollingIntervalMs,
    computeServerPollingIntervalMs: options.computeServerPollingIntervalMs,
    useHttp: options.coderUrl.startsWith("http://"),
  });

  return {
    workspaceInfo: {
      workspaceId: readyWorkspace.id,
      workspaceName: readyWorkspace.name,
      ownerName: me.username,
      agentId: agent.id,
      agentName: agent.name,
    },
    message: `Workspace "${me.username}/${readyWorkspace.name}" initialized.`,
  };
};

export interface GetCoderWorkspaceClientOptions {
  /** Coder deployment URL */
  coderUrl: string;
  /** Session token for authentication */
  sessionToken: string;
  /** Port the blink compute server is listening on (default: 22137) */
  computeServerPort?: number;
  /** Optional CoderApiClient instance (for testing) */
  client?: CoderApiClient;
}

/**
 * Creates a compute client connected to a Coder workspace.
 * Uses WebSocket via the Coder app proxy to connect directly to the compute server port.
 */
export const getCoderWorkspaceClient = async (
  options: GetCoderWorkspaceClientOptions,
  workspaceInfo: CoderWorkspaceInfo
): Promise<Client> => {
  const computeServerPort = options.computeServerPort ?? COMPUTE_SERVER_PORT;
  const client =
    options.client ??
    new CoderApiClient(options.coderUrl, options.sessionToken);

  // Get app hostname for subdomain proxy
  const appHostname = await client.getAppHost();
  if (!appHostname) {
    throw new Error(
      "Coder deployment does not have a wildcard app hostname configured. " +
        "This is required for workspace app access."
    );
  }

  // Verify workspace exists and is running
  const workspace = await client.getWorkspace(workspaceInfo.workspaceId);

  if (workspace.latest_build.status !== "running") {
    throw new Error(
      `Workspace ${workspaceInfo.workspaceName} is not running (status: ${workspace.latest_build.status}). Start it first.`
    );
  }

  // Get agent info
  const agents = getAgentsFromWorkspace(workspace);
  const agent =
    agents.find((a) => a.id === workspaceInfo.agentId) ||
    agents.find((a) => a.name === workspaceInfo.agentName);

  if (!agent) {
    throw new Error(
      `Agent not found for workspace ${workspaceInfo.workspaceName}. Available agents: ${agents.map((a) => a.name).join(", ")}`
    );
  }

  if (agent.status !== "connected") {
    throw new Error(
      `Agent '${agent.name}' is not connected (status: ${agent.status}). Wait for it to connect.`
    );
  }

  // Connect via the Coder app proxy using subdomain format
  // For ports, agent name is REQUIRED
  const appSubdomain = `${computeServerPort}--${agent.name}--${workspaceInfo.workspaceName}--${workspaceInfo.ownerName}`;

  // Replace the wildcard in appHostname with the subdomain
  // e.g., "*.apps.coder.com" -> "22137--dev--main--hugo.apps.coder.com"
  const appHost = appHostname.replace("*", appSubdomain);

  // Use ws:// for http:// URLs (e.g., local development), wss:// otherwise
  const wsProtocol = options.coderUrl.startsWith("http://") ? "ws" : "wss";
  const proxyUrl = `${wsProtocol}://${appHost}/`;

  try {
    const ws = new WebSocket(proxyUrl, {
      headers: {
        // Coder supports multiple auth methods - using both for compatibility
        "Coder-Session-Token": options.sessionToken,
        Cookie: `coder_session_token=${options.sessionToken}`,
      },
    });

    return newComputeClient(ws);
  } catch (err) {
    throw new Error(
      `Failed to connect to compute server. ` +
        `Make sure the blink compute server is running in the workspace. ` +
        `Original error: ${err}`
    );
  }
};
