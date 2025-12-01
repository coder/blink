import type { Client } from "@blink-sdk/compute-protocol/client";
import { Daytona } from "@daytonaio/sdk";
import { WebSocket } from "ws";
import type { Logger } from "../../types";
import { newComputeClient } from "../common";

/** Minimal interface for what we use from a Daytona sandbox/workspace. */
export interface DaytonaSandbox {
  id: string;
  state?: string;
  start(timeout: number): Promise<void>;
  getPreviewLink(port: number): Promise<{ url: string; token: string }>;
}

/** Minimal interface for what we use from the Daytona SDK client. */
export interface DaytonaClient {
  get(id: string): Promise<DaytonaSandbox>;
  create(opts: {
    snapshot: string;
    autoDeleteInterval: number;
    envVars?: Record<string, string>;
    labels?: Record<string, string>;
  }): Promise<DaytonaSandbox>;
}

export interface DaytonaWorkspaceInfo {
  id: string;
}

export interface InitializeDaytonaWorkspaceOptions {
  daytonaApiKey: string;
  /** The snapshot must initialize the Blink compute server on startup on the port supplied to `getDaytonaWorkspaceClient`. */
  snapshot: string;
  /** Default is 60. */
  autoDeleteIntervalMinutes?: number;
  envVars?: Record<string, string>;
  labels?: Record<string, string>;
  /** Optional Daytona SDK client for testing. If not provided, a real client is created. */
  daytonaSdk?: DaytonaClient;
}

export const initializeDaytonaWorkspace = async (
  logger: Logger,
  options: InitializeDaytonaWorkspaceOptions,
  existingWorkspaceInfo: DaytonaWorkspaceInfo | undefined
): Promise<{ workspaceInfo: DaytonaWorkspaceInfo; message: string }> => {
  const daytona: DaytonaClient =
    options.daytonaSdk ?? new Daytona({ apiKey: options.daytonaApiKey });
  if (existingWorkspaceInfo) {
    try {
      // I think this throws if the workspace doesn't exist anymore.
      const ws = await daytona.get(existingWorkspaceInfo.id);
      if (
        ws.state === "started" ||
        ws.state === "creating" ||
        ws.state === "starting"
      ) {
        return {
          workspaceInfo: existingWorkspaceInfo,
          message: `Workspace already initialized. It's in this state: ${ws.state}`,
        };
      }
    } catch (err: unknown) {
      logger.warn(
        `Error fetching Daytona workspace with id ${existingWorkspaceInfo.id}, will create a new one instead.`,
        err
      );
    }
  }
  const created = await daytona.create({
    snapshot: options.snapshot,
    autoDeleteInterval: options.autoDeleteIntervalMinutes ?? 60,
    envVars: options.envVars,
    labels: options.labels,
  });
  return {
    workspaceInfo: { id: created.id },
    message: "Workspace initialized.",
  };
};

export interface GetDaytonaWorkspaceClientOptions {
  daytonaApiKey: string;
  computeServerPort: number;
  /** Optional Daytona SDK client for testing. If not provided, a real client is created. */
  daytonaSdk?: DaytonaClient;
}

export const getDaytonaWorkspaceClient = async (
  options: GetDaytonaWorkspaceClientOptions,
  workspaceInfo: DaytonaWorkspaceInfo
): Promise<Client> => {
  const daytona: DaytonaClient =
    options.daytonaSdk ?? new Daytona({ apiKey: options.daytonaApiKey });
  const sandbox = await daytona.get(workspaceInfo.id);
  if (sandbox.state === "stopped") {
    // timeout is in seconds
    await sandbox.start(60);
  }
  const url = await sandbox.getPreviewLink(options.computeServerPort);
  const wsClient = await newComputeClient(
    new WebSocket(url.url, {
      headers: {
        "x-daytona-preview-token": url.token,
      },
    })
  );
  return wsClient;
};
