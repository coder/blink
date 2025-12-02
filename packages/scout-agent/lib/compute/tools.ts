import * as compute from "@blink-sdk/compute";
import type { Client } from "@blink-sdk/compute-protocol/client";
import * as github from "@blink-sdk/github";
import { type Tool, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import type { Message } from "../types";
import { WORKSPACE_INFO_KEY } from "./common";

export const createComputeTools = <T>({
  agent,
  getGithubAppContext,
  initializeWorkspace,
  createWorkspaceClient,
}: {
  agent: blink.Agent<Message>;
  initializeWorkspace: (
    existingWorkspaceInfo: T | undefined
  ) => Promise<{ workspaceInfo: T; message: string }>;
  createWorkspaceClient: (workspaceInfo: T) => Promise<Client>;
  /**
   * A function that returns the GitHub auth context for Git authentication.
   * If provided, the workspace_authenticate_git tool will be available.
   */
  getGithubAppContext?: () => Promise<github.AppAuthOptions>;
}): Record<string, Tool> => {
  const newClient = async () => {
    const workspaceInfo = await agent.store.get(WORKSPACE_INFO_KEY);
    if (!workspaceInfo) {
      throw new Error(
        "Workspace not initialized. Call initialize_workspace first."
      );
    }
    const parsedWorkspaceInfo = JSON.parse(workspaceInfo);
    return createWorkspaceClient(parsedWorkspaceInfo);
  };

  return {
    initialize_workspace: tool({
      description: "Initialize a workspace for the user.",
      inputSchema: z.object({}),
      execute: async (_args, _opts) => {
        const existingWorkspaceInfoRaw =
          await agent.store.get(WORKSPACE_INFO_KEY);
        const existingWorkspaceInfo = existingWorkspaceInfoRaw
          ? JSON.parse(existingWorkspaceInfoRaw)
          : undefined;
        const { workspaceInfo, message } = await initializeWorkspace(
          existingWorkspaceInfo
        );
        await agent.store.set(
          WORKSPACE_INFO_KEY,
          JSON.stringify(workspaceInfo)
        );
        return message;
      },
    }),

    ...(getGithubAppContext
      ? {
          workspace_authenticate_git: tool({
            description: `Authenticate with Git repositories for push/pull operations. Call this before any Git operations that require authentication.

**Re-authenticate if:**
- Git operations fail with authentication errors
- You get "permission denied" or "not found" errors on private repos
- The workspace appears to have reset

It's safe to call this multiple times - re-authenticating is perfectly fine and often necessary.`,
            inputSchema: z.object({
              owner: z.string(),
              repos: z.array(z.string()),
            }),
            execute: async (args, _opts) => {
              const client = await newClient();

              // Here we generate a GitHub token scoped to the repositories.
              const githubAppContext = await getGithubAppContext();
              if (!githubAppContext) {
                throw new Error(
                  "You can only use public repositories in this context."
                );
              }
              const token = await github.authenticateApp({
                ...githubAppContext,
                // TODO: We obviously need to handle owner at some point.
                repositoryNames: args.repos,
              });
              const resp = await client.request("process_execute", {
                command: `sh`,
                args: [
                  "-c",
                  `echo "$TOKEN" | gh auth login --with-token && gh auth setup-git`,
                ],
                env: {
                  TOKEN: token,
                },
              });
              const respWait = await client.request("process_wait", {
                pid: resp.pid,
              });
              if (respWait.exit_code !== 0) {
                throw new Error(
                  `Failed to authenticate with Git. Output: ${respWait.plain_output.lines.join("\n")}`
                );
              }
              return "Git authenticated.";
            },
          }),
        }
      : {}),
    ...blink.tools.withContext(compute.tools, {
      client: newClient,
    }),
  };
};
