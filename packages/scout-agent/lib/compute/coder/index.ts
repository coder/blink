import type { Client } from "@blink-sdk/compute-protocol/client";
import { WebSocket } from "ws";
import type { Logger } from "../../types";
import { newComputeClient } from "../common";

// ============================================================================
// Coder API Types (based on codersdk)
// ============================================================================

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

interface WorkspaceBuildParameter {
  name: string;
  value: string;
}

interface CreateWorkspaceRequest {
  template_id?: string;
  template_version_id?: string;
  name: string;
  rich_parameter_values?: WorkspaceBuildParameter[];
}

interface CreateWorkspaceBuildRequest {
  transition: WorkspaceTransition;
  rich_parameter_values?: WorkspaceBuildParameter[];
}

interface CoderApiError {
  message: string;
  detail?: string;
}

// ============================================================================
// Coder HTTP API Client
// ============================================================================

class CoderApiClient {
  private readonly baseUrl: string;
  private readonly sessionToken: string;

  constructor(baseUrl: string, sessionToken: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sessionToken = sessionToken;
  }

  private async request<T>(
    method: string,
    path: string,
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
        const errorBody = (await response.json()) as CoderApiError;
        errorMessage = errorBody.message || errorMessage;
        if (errorBody.detail) {
          errorMessage += ` - ${errorBody.detail}`;
        }
      } catch {
        // Ignore JSON parse errors, use default message
      }
      throw new Error(errorMessage);
    }

    // Handle empty responses (204 No Content, etc.)
    const contentType = response.headers.get("content-type");
    if (
      response.status === 204 ||
      !contentType?.includes("application/json")
    ) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // Get current authenticated user
  async getMe(): Promise<{ id: string; username: string }> {
    return this.request("GET", "/api/v2/users/me");
  }

  // Get workspace by owner and name
  async getWorkspaceByOwnerAndName(
    owner: string,
    name: string
  ): Promise<Workspace | undefined> {
    try {
      return await this.request<Workspace>(
        "GET",
        `/api/v2/users/${encodeURIComponent(owner)}/workspace/${encodeURIComponent(name)}`
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
    return this.request<Workspace>(
      "GET",
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`
    );
  }

  // Get template by name in organization
  async getTemplateByName(
    organizationId: string,
    templateName: string
  ): Promise<Template | undefined> {
    try {
      return await this.request<Template>(
        "GET",
        `/api/v2/organizations/${encodeURIComponent(organizationId)}/templates/${encodeURIComponent(templateName)}`
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        return undefined;
      }
      throw err;
    }
  }

  // Get default organization
  async getDefaultOrganization(): Promise<{ id: string; name: string }> {
    return this.request("GET", "/api/v2/organizations/default");
  }

  // Create workspace in organization
  async createWorkspace(
    organizationId: string,
    request: CreateWorkspaceRequest
  ): Promise<Workspace> {
    return this.request<Workspace>(
      "POST",
      `/api/v2/organizations/${encodeURIComponent(organizationId)}/members/me/workspaces`,
      request
    );
  }

  // Create a new workspace build (start/stop/delete)
  async createWorkspaceBuild(
    workspaceId: string,
    request: CreateWorkspaceBuildRequest
  ): Promise<WorkspaceBuild> {
    return this.request<WorkspaceBuild>(
      "POST",
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/builds`,
      request
    );
  }

  // Get the WebSocket URL for the terminal/reconnecting PTY
  getReconnectingPtyUrl(
    agentId: string,
    reconnect: string,
    width: number,
    height: number,
    command?: string
  ): string {
    const baseWsUrl = this.baseUrl.replace(/^http/, "ws");
    const params = new URLSearchParams({
      reconnect,
      width: String(width),
      height: String(height),
    });
    if (command) {
      params.set("command", command);
    }
    return `${baseWsUrl}/api/v2/workspaceagents/${agentId}/pty?${params.toString()}`;
  }
}

// ============================================================================
// Exported Types and Functions
// ============================================================================

export interface CoderWorkspaceInfo {
  /** Workspace ID (UUID) */
  workspaceId: string;
  /** Workspace name */
  workspaceName: string;
  /** Owner username */
  ownerName: string;
  /** Agent ID to connect to */
  agentId: string;
  /** Agent name */
  agentName: string;
}

export interface InitializeCoderWorkspaceOptions {
  /** Coder deployment URL (e.g., https://coder.example.com) */
  coderUrl: string;
  /** Session token for authentication */
  sessionToken: string;
  /** Port the blink compute server will listen on inside the workspace */
  computeServerPort: number;
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
   * Time to wait for workspace to start (in seconds). Default is 300 (5 minutes).
   */
  startTimeoutSeconds?: number;
}

const COMPUTE_SERVER_PORT = 22137;

const BOOTSTRAP_SCRIPT = `
set -e
echo "Installing blink..."
npm install -g blink@latest 2>&1 || { echo "Failed to install blink"; exit 1; }
echo "Starting compute server..."
HOST=0.0.0.0 PORT=$BLINK_PORT blink compute server
`.trim();

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

/**
 * Waits for workspace to be running and agent to be connected.
 */
async function waitForWorkspaceReady(
  client: CoderApiClient,
  workspaceId: string,
  agentName: string | undefined,
  timeoutSeconds: number,
  logger: Logger
): Promise<{ workspace: Workspace; agent: WorkspaceAgent }> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    const workspace = await client.getWorkspace(workspaceId);
    const status = workspace.latest_build.status;
    logger.info(`Workspace ${workspace.name} status: ${status}`);

    if (status === "failed" || status === "canceled" || status === "deleted") {
      throw new Error(
        `Workspace ${workspace.name} is in terminal state: ${status}`
      );
    }

    if (status === "running") {
      const agents = getAgentsFromWorkspace(workspace);
      if (agents.length === 0) {
        logger.info("Waiting for agents to be available...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
        logger.info(`Agent '${agent.name}' is connected`);
        return { workspace, agent };
      }

      logger.info(
        `Waiting for agent '${agent.name}' to connect (status: ${agent.status})...`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    `Timeout waiting for workspace to be ready after ${timeoutSeconds} seconds`
  );
}

/**
 * Executes a command in the workspace via the reconnecting PTY API.
 */
async function executeInWorkspace(
  client: CoderApiClient,
  agentId: string,
  command: string,
  sessionToken: string,
  logger: Logger
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const reconnectId = crypto.randomUUID();
    const ptyUrl = client.getReconnectingPtyUrl(
      agentId,
      reconnectId,
      80,
      24,
      command
    );

    const ws = new WebSocket(ptyUrl, {
      headers: {
        "Coder-Session-Token": sessionToken,
      },
    });

    let output = "";
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        // For long-running commands, we consider timeout as success if we got output
        resolve({
          output,
          exitCode: output.includes("Compute server running") ? 0 : 1,
        });
      }
    }, 120000); // 2 minute timeout

    ws.on("open", () => {
      logger.info(`Executing command in workspace: ${command.slice(0, 50)}...`);
    });

    ws.on("message", (data: Buffer) => {
      const message = data.toString();
      output += message;
      // Check for success indicators
      if (message.includes("Compute server running")) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          // Don't close immediately - the server should keep running
          resolve({ output, exitCode: 0 });
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        // Check output for success/failure indicators
        const exitCode =
          output.includes("Failed") || output.includes("error") ? 1 : 0;
        resolve({ output, exitCode });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

/**
 * Checks if the blink compute server is running in the workspace.
 */
async function isComputeServerRunning(
  client: CoderApiClient,
  agentId: string,
  sessionToken: string,
  logger: Logger
): Promise<boolean> {
  try {
    const { output } = await executeInWorkspace(
      client,
      agentId,
      "pgrep -f 'blink compute server' || echo 'NOT_RUNNING'",
      sessionToken,
      logger
    );
    return !output.includes("NOT_RUNNING");
  } catch {
    return false;
  }
}

/**
 * Installs and starts the blink compute server in the workspace.
 */
async function installComputeServer(
  client: CoderApiClient,
  agentId: string,
  computeServerPort: number,
  sessionToken: string,
  logger: Logger
): Promise<void> {
  // Check if already running
  if (await isComputeServerRunning(client, agentId, sessionToken, logger)) {
    logger.info("Blink compute server is already running");
    return;
  }

  logger.info("Installing and starting blink compute server...");

  // Create the startup script
  const script = BOOTSTRAP_SCRIPT.replace(
    "$BLINK_PORT",
    String(computeServerPort)
  );

  // Execute in background using nohup
  const command = `nohup bash -c '${script.replace(/'/g, "'\\''")}' > /tmp/blink-compute.log 2>&1 &`;

  const { output, exitCode } = await executeInWorkspace(
    client,
    agentId,
    command,
    sessionToken,
    logger
  );

  if (exitCode !== 0) {
    throw new Error(`Failed to start compute server: ${output}`);
  }

  // Wait for server to start by checking logs
  const startTime = Date.now();
  const timeout = 60000; // 60 seconds

  while (Date.now() - startTime < timeout) {
    const { output: logs } = await executeInWorkspace(
      client,
      agentId,
      "cat /tmp/blink-compute.log 2>/dev/null || echo 'LOG_NOT_FOUND'",
      sessionToken,
      logger
    );

    if (logs.includes("Compute server running")) {
      logger.info("Blink compute server started successfully");
      return;
    }

    if (
      logs.includes("Failed to install blink") ||
      logs.includes("npm ERR!")
    ) {
      throw new Error(`Failed to install blink: ${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
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
  const client = new CoderApiClient(options.coderUrl, options.sessionToken);
  const computeServerPort = options.computeServerPort || COMPUTE_SERVER_PORT;
  const timeoutSeconds = options.startTimeoutSeconds || 300;

  // Get current user for owner name
  const me = await client.getMe();

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
          await installComputeServer(
            client,
            agent.id,
            computeServerPort,
            options.sessionToken,
            logger
          );

          return {
            workspaceInfo: {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              ownerName: workspace.owner_name,
              agentId: agent.id,
              agentName: agent.name,
            },
            message: "Workspace already initialized and running.",
          };
        }
      }

      if (status === "stopped" || status === "stopping") {
        logger.info(`Starting stopped workspace ${workspace.name}...`);
        await client.createWorkspaceBuild(workspace.id, {
          transition: "start",
        });

        const { workspace: readyWorkspace, agent } = await waitForWorkspaceReady(
          client,
          workspace.id,
          existingWorkspaceInfo.agentName,
          timeoutSeconds,
          logger
        );

        await installComputeServer(
          client,
          agent.id,
          computeServerPort,
          options.sessionToken,
          logger
        );

        return {
          workspaceInfo: {
            workspaceId: readyWorkspace.id,
            workspaceName: readyWorkspace.name,
            ownerName: readyWorkspace.owner_name,
            agentId: agent.id,
            agentName: agent.name,
          },
          message: "Workspace started and initialized.",
        };
      }

      if (status === "starting" || status === "pending") {
        const { workspace: readyWorkspace, agent } = await waitForWorkspaceReady(
          client,
          workspace.id,
          existingWorkspaceInfo.agentName,
          timeoutSeconds,
          logger
        );

        await installComputeServer(
          client,
          agent.id,
          computeServerPort,
          options.sessionToken,
          logger
        );

        return {
          workspaceInfo: {
            workspaceId: readyWorkspace.id,
            workspaceName: readyWorkspace.name,
            ownerName: readyWorkspace.owner_name,
            agentId: agent.id,
            agentName: agent.name,
          },
          message: "Workspace initialized.",
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

  logger.info("Creating new Coder workspace...");

  // Get default organization and template
  const org = await client.getDefaultOrganization();
  const template = await client.getTemplateByName(org.id, options.template);
  if (!template) {
    throw new Error(
      `Template '${options.template}' not found in organization '${org.name}'`
    );
  }

  const workspaceName =
    options.workspaceName || `blink-${Date.now().toString(36)}`;

  const workspace = await client.createWorkspace(org.id, {
    template_id: template.id,
    name: workspaceName,
    rich_parameter_values: options.richParameters,
  });

  const { workspace: readyWorkspace, agent } = await waitForWorkspaceReady(
    client,
    workspace.id,
    options.agentName,
    timeoutSeconds,
    logger
  );

  await installComputeServer(
    client,
    agent.id,
    computeServerPort,
    options.sessionToken,
    logger
  );

  return {
    workspaceInfo: {
      workspaceId: readyWorkspace.id,
      workspaceName: readyWorkspace.name,
      ownerName: me.username,
      agentId: agent.id,
      agentName: agent.name,
    },
    message: "Workspace initialized.",
  };
};

export interface GetCoderWorkspaceClientOptions {
  /** Coder deployment URL */
  coderUrl: string;
  /** Session token for authentication */
  sessionToken: string;
  /** Port the blink compute server is listening on */
  computeServerPort: number;
}

/**
 * Creates a compute client connected to a Coder workspace.
 * Uses WebSocket via the reconnecting PTY API to tunnel to the compute server.
 */
export const getCoderWorkspaceClient = async (
  options: GetCoderWorkspaceClientOptions,
  workspaceInfo: CoderWorkspaceInfo
): Promise<Client> => {
  const client = new CoderApiClient(options.coderUrl, options.sessionToken);

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

  // Connect via PTY with netcat to tunnel to the compute server
  // This bridges WebSocket -> PTY -> netcat -> TCP to compute server
  const baseWsUrl = options.coderUrl.replace(/^http/, "ws");
  const reconnectId = crypto.randomUUID();
  const ncCommand = `nc -q0 127.0.0.1 ${options.computeServerPort}`;

  const ptyUrl = `${baseWsUrl}/api/v2/workspaceagents/${workspaceInfo.agentId}/pty?reconnect=${encodeURIComponent(reconnectId)}&width=80&height=24&command=${encodeURIComponent(ncCommand)}`;

  try {
    const ws = new WebSocket(ptyUrl, {
      headers: {
        "Coder-Session-Token": options.sessionToken,
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
