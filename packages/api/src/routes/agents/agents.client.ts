import type { UIOptions, UIOptionsSchema } from "blink";
import { z } from "zod";
import {
  assertResponseStatus,
  nameFormat,
  schemaPaginatedRequest,
  schemaPaginatedResponse,
  streamSSE,
} from "../../client-helper";
import Client from "../../client.browser";
import {
  createAsyncIterableStream,
  type AsyncIterableStream,
} from "../../util/async-iterable-stream";
import AgentDeployments, {
  schemaAgentDeploymentUploadFile,
} from "./deployments.client";
import AgentEnv, { schemaCreateAgentEnv } from "./env.client";
import AgentLogs from "./logs.client";
import AgentMembers from "./members.client";
import AgentRuns from "./runs.client";
import AgentSteps from "./steps.client";
import AgentTraces from "./traces.client";

export const schemaAgentVisibility = z.enum([
  "private",
  "public",
  "organization",
]);

export const schemaCreateAgentRequest = z.object({
  organization_id: z.uuid(),
  name: z.string().regex(nameFormat),

  description: z.string().optional(),
  visibility: schemaAgentVisibility.default("organization").optional(),
  // Time-to-live in seconds for chats created by this agent.
  // null or undefined means chats never expire (kept forever).
  chat_expire_ttl: z.number().int().positive().nullable().optional(),

  // These can optionally provided to trigger a deployment.
  source_files: z.array(schemaAgentDeploymentUploadFile).optional(),
  // If provided, a build will not occur and the files will be used as-is.
  output_files: z.array(schemaAgentDeploymentUploadFile).optional(),
  entrypoint: z.string().optional(),
  env: z.array(schemaCreateAgentEnv).optional(),

  // Optional: Specify the request_id for the production deployment target.
  // This is useful for setting up webhooks before the agent is fully deployed.
  request_id: z.uuid().optional(),
});

export type CreateAgentRequest = z.infer<typeof schemaCreateAgentRequest>;

export const schemaAgent = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  created_by: z.uuid(),
  name: z.string().regex(nameFormat),
  description: z.string().nullable(),
  avatar_url: z.string().nullable(),
  visibility: schemaAgentVisibility,
  active_deployment_id: z.uuid().nullable(),
  pinned: z.boolean().default(false),
  request_url: z
    .url()
    .nullable()
    .describe("The URL for the agent requests. Only visible to owners."),
  chat_expire_ttl: z.number().int().positive().nullable(),
  user_permission: z.enum(["read", "write", "admin"]).optional(),
});

export const schemaUpdateAgentRequest = z.object({
  id: z.uuid(),
  name: z.string().regex(nameFormat).optional(),
  description: z.string().optional(),
  visibility: schemaAgentVisibility.optional(),
  active_deployment_id: z.uuid().optional(),
  avatar_file_id: z.uuid().nullable().optional(),
  chat_expire_ttl: z.number().int().positive().nullable().optional(),
});

export type UpdateAgentRequest = z.infer<typeof schemaUpdateAgentRequest>;

export type Agent = z.infer<typeof schemaAgent>;

export const schemaListAgentsRequest = schemaPaginatedRequest.extend({
  organization_id: z.uuid().optional(),
  pinned: z.boolean().optional(),
});

export type ListAgentsRequest = z.infer<typeof schemaListAgentsRequest>;

export const schemaListAgentsResponse = schemaPaginatedResponse(schemaAgent);

export type ListAgentsResponse = z.infer<typeof schemaListAgentsResponse>;

export const schemaAgentCompletionRequest = z.object({
  agent_id: z.uuid(),
  input: z.string(),
  caret: z.number().optional(),
  selection: z.tuple([z.number(), z.number()]).optional(),

  chat_id: z.uuid().optional(),
  agent_deployment_id: z.uuid().optional(),
});

export type AgentCompletionRequest = z.infer<
  typeof schemaAgentCompletionRequest
>;

export const schemaAgentCompletionResponse = z.object({
  text: z.string(),
  caret: z.number().optional(),
  selection: z.tuple([z.number(), z.number()]).optional(),
});

export type AgentCompletion =
  | {
      text: string;
      replace?: [number, number];
    }
  | {
      id: string;
      label: string;
      detail?: string;
      insertText?: string;
      replace?: [number, number];
    };

export const schemaAgentUIOptionsRequest = z.object({
  agent_id: z.uuid(),
  agent_deployment_id: z.uuid().optional(),
  selected: z.record(z.string(), z.string()).optional(),
});

export type AgentUIOptionsRequest = z.infer<typeof schemaAgentUIOptionsRequest>;

export const schemaAgentRuntimeUsageRequest = z.object({
  agent_id: z.uuid(),
  start_time: z.iso.datetime().pipe(z.coerce.date()),
  end_time: z.iso.datetime().pipe(z.coerce.date()),
});

export type AgentRuntimeUsageRequest = z.infer<
  typeof schemaAgentRuntimeUsageRequest
>;

export const schemaAgentRuntimeUsageResponse = z.object({
  seconds: z.string(),
});

export type AgentRuntimeUsageResponse = z.infer<
  typeof schemaAgentRuntimeUsageResponse
>;

export default class Agents {
  private readonly client: Client;
  public readonly deployments: AgentDeployments;
  public readonly env: AgentEnv;
  public readonly runs: AgentRuns;
  public readonly steps: AgentSteps;
  public readonly logs: AgentLogs;
  public readonly traces: AgentTraces;
  public readonly members: AgentMembers;

  public constructor(client: Client) {
    this.client = client;
    this.deployments = new AgentDeployments(client);
    this.env = new AgentEnv(client);
    this.runs = new AgentRuns(client);
    this.steps = new AgentSteps(client);
    this.logs = new AgentLogs(client);
    this.traces = new AgentTraces(client);
    this.members = new AgentMembers(client);
  }

  /**
   * Create an agent.
   *
   * @param request - The request body.
   * @returns The agent.
   */
  public async create(request: CreateAgentRequest): Promise<Agent> {
    const resp = await this.client.request(
      "POST",
      "/api/agents",
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Update an agent.
   *
   * @param request - The request body.
   * @returns The agent.
   */
  public async update(request: UpdateAgentRequest): Promise<Agent> {
    const resp = await this.client.request(
      "PATCH",
      `/api/agents/${request.id}`,
      JSON.stringify(request)
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Get an agent.
   *
   * @param id - The id of the agent.
   * @returns The agent.
   */
  public async get(id: string): Promise<Agent> {
    const resp = await this.client.request("GET", `/api/agents/${id}`);
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * List agents.
   *
   * @param request - The request body.
   * @returns The agents.
   */
  public async list(request: ListAgentsRequest): Promise<ListAgentsResponse> {
    const query = new URLSearchParams();
    if (request.organization_id) {
      query.set("organization_id", request.organization_id);
    }
    if (request.page) {
      query.set("page", request.page.toString());
    }
    if (request.per_page) {
      query.set("per_page", request.per_page.toString());
    }
    if (typeof request.pinned === "boolean") {
      query.set("pinned", request.pinned.toString());
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Delete an agent.
   *
   * @param id - The id of the agent.
   */
  public async delete(id: string): Promise<void> {
    const resp = await this.client.request("DELETE", `/api/agents/${id}`);
    await assertResponseStatus(resp, 204);
  }

  /**
   * Get input completions for an agent.
   *
   * @param request - The request body.
   * @returns The completions.
   */
  public async completions(
    request: AgentCompletionRequest
  ): Promise<AsyncIterableStream<AgentCompletion>> {
    const req = await this.client.request(
      "POST",
      `/api/agents/${request.agent_id}/completions`,
      JSON.stringify(request)
    );
    await assertResponseStatus(req, 200);
    if (req.headers.get("content-type") === "application/json") {
      const body: AgentCompletion = await req.json();
      return createAsyncIterableStream(
        new ReadableStream({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        })
      );
    }
    return streamSSE(req, schemaAgentCompletionResponse);
  }

  /**
   * Get the options schema for an agent.
   *
   * @param request - The request body.
   * @returns The options schema.
   */
  public async uiOptions(
    request: AgentUIOptionsRequest
  ): Promise<UIOptionsSchema<UIOptions>> {
    const query = new URLSearchParams();
    if (request.agent_deployment_id) {
      query.set("agent_deployment_id", request.agent_deployment_id);
    }
    if (request.selected) {
      query.set("selected", JSON.stringify(request.selected));
    }
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/ui-options?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }

  /**
   * Pin an agent for the current user.
   *
   * @param id - The id of the agent.
   */
  public async pin(id: string): Promise<void> {
    const resp = await this.client.request("POST", `/api/agents/${id}/pin`);
    await assertResponseStatus(resp, 204);
  }

  /**
   * Unpin an agent for the current user.
   *
   * @param id - The id of the agent.
   */
  public async unpin(id: string): Promise<void> {
    const resp = await this.client.request("DELETE", `/api/agents/${id}/pin`);
    await assertResponseStatus(resp, 204);
  }

  /**
   * Get runtime usage for an agent.
   *
   * @param request - The request body.
   * @returns The runtime usage in seconds.
   */
  public async getRuntimeUsage(
    request: AgentRuntimeUsageRequest
  ): Promise<AgentRuntimeUsageResponse> {
    const query = new URLSearchParams();
    query.set("start_time", request.start_time.toISOString());
    query.set("end_time", request.end_time.toISOString());
    const resp = await this.client.request(
      "GET",
      `/api/agents/${request.agent_id}/usage/runtime?${query.toString()}`
    );
    await assertResponseStatus(resp, 200);
    return resp.json();
  }
}

export * from "./deployments.client";
export * from "./members.client";
export * from "./runs.client";
export * from "./steps.client";
