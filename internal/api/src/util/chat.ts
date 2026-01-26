import type Querier from "@blink.so/database/querier";
import {
  BlinkInvocationRunIDHeader,
  BlinkInvocationStepIDHeader,
  BlinkInvocationChatIDHeader,
  BlinkInvocationTokenHeader,
} from "@blink.so/runtime/types";
import {
  isToolOrDynamicToolUIPart,
  isToolUIPart,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { ID, ToolApprovalOutput } from "blink";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { z } from "zod";
import type { StreamChatEvent } from "../client.browser";

export interface RunChatOptions {
  // The chat ID to run.
  id: string;
  signal: AbortSignal;
  db: Querier;

  broadcast: (event: StreamChatEvent) => Promise<void>;
  waitUntil: (promise: Promise<unknown>) => void;
  writePlatformLog?: (opts: {
    agentId: string;
    event: Record<string, unknown>;
  }) => void;

  env: {
    AUTH_SECRET: string;
  };
}

/**
 * runChat executes a chat run. It gets the latest chat step and executes it.
 * The onus is on the caller to ensure that this does not run multiple times for the same chat.
 */
export async function runChat({
  id,
  db,
  signal,
  broadcast,
  waitUntil,
  env,
  writePlatformLog,
}: RunChatOptions): Promise<{
  continue: boolean;
}> {
  const broadcastChatUpdate = async () => {
    const chat = await db.selectChatByID({ id });
    if (!chat) {
      throw new Error("Chat not found");
    }
    broadcast({
      event: "chat.updated",
      data: {
        ...chat,
        created_at: chat.created_at.toISOString(),
        updated_at: new Date().toISOString(),
        expire_ttl: chat.expire_ttl,
        expires_at: chat.expire_ttl
          ? new Date(
              chat.created_at.getTime() + chat.expire_ttl * 1000
            ).toISOString()
          : null,
        agent: {
          ...chat.agent,
          pinned: false,
          created_at: chat.agent.created_at.toISOString(),
          updated_at: chat.agent.updated_at.toISOString(),
          avatar_url: chat.agent.avatar_file_id
            ? `/api/files/${chat.agent.avatar_file_id}`
            : null,
          request_url: null,
          chat_expire_ttl: chat.agent.chat_expire_ttl,
          user_permission: undefined,
        },
      },
    });
  };

  const latestChatRun = await db.selectLatestChatRun(id);
  if (!latestChatRun) {
    throw new Error("The chat was executed without a run");
  }
  const { run, step } = latestChatRun;
  if (!step) {
    return {
      continue: false,
    };
  }

  // always use the active deployment
  const deployment = await db.selectAgentDeploymentByIDOrActive({
    agentID: run.agent_id,
  });
  if (!deployment) {
    throw new Error("Agent has no active deployment!");
  }
  const baseURL = deployment.direct_access_url;
  if (!baseURL) {
    throw new Error("Agent deployment has no run URL!");
  }
  const dbMessages = await db.selectMessagesByChatID(id);
  const { Client } = await import("blink/client");
  const client = new Client({
    baseUrl: baseURL,
  });
  const firstMessageID = dbMessages[0]?.id;
  const lastMessageID = dbMessages[dbMessages.length - 1]?.id;
  await db.updateChatRunStep({
    id: step.id,
    first_message_id: firstMessageID ?? null,
    last_message_id: lastMessageID ?? null,
  });

  await broadcastChatUpdate();

  let stream: ReadableStream<UIMessageChunk>;
  const reqId = crypto.randomUUID();
  const requestStart = performance.now();
  using hb = startHeartbeat({
    waitUntil,
    db,
    stepId: step.id,
  });

  try {
    // Fire-and-forget platform log (must not block)
    writePlatformLog?.({
      agentId: run.agent_id,
      event: {
        type: "blink.request.send_messages",
        level: "info",
        ts: new Date().toISOString(),
        source: "platform",
        message: "Sending messages to agent",
        agent: {
          id: run.agent_id,
          deployment_id: deployment.id,
        },
        correlation: {
          chat_id: id,
          run_id: run.id,
          step_id: step.id,
          request_id: reqId,
        },
      },
    });

    if (!env.AUTH_SECRET) {
      // biome-ignore lint/suspicious/noConsole: we want to notify the admin if this happens.
      console.error(
        "runChat: AUTH_SECRET environment variable is not set. Unable to generate agent invocation token."
      );
      throw new Error("Internal server error");
    }
    const { generateAgentInvocationToken } = await import(
      "@blink.so/api/agents/me/server"
    );
    const headers = {
      [BlinkInvocationTokenHeader]: await generateAgentInvocationToken(
        env.AUTH_SECRET,
        {
          agent_id: run.agent_id,
          agent_deployment_id: deployment.id,
          agent_deployment_target_id: deployment.target_id,
          step_id: step.id,
          run_id: run.id,
          chat_id: id,
        }
      ),
      [BlinkInvocationRunIDHeader]: run.id,
      [BlinkInvocationStepIDHeader]: step.id,
      [BlinkInvocationChatIDHeader]: id,
    };

    if (deployment.compatibility_version === "3") {
      // TODO: we should cache the key.
      const chat = await db.selectChatByID({ id });
      if (!chat) {
        throw new Error("Chat not found");
      }
      stream = await client.chat(
        {
          id: chat.id as ID,
          messages: dbMessages.map((m) => ({
            id: m.id,
            parts: m.parts,
            role: m.role,
            metadata: m.metadata,
          })),
        },
        {
          signal,
          headers,
        }
      );
    } else {
      let runURL: URL;
      if (deployment.compatibility_version === "1") {
        runURL = new URL("/sendMessages", baseURL);
      } else {
        runURL = new URL("/_agent/send-messages", baseURL);
      }
      const resp = await fetch(runURL, {
        method: "POST",
        body: JSON.stringify({
          chat: {
            id,
          },
          messages: dbMessages.map((m) => ({
            id: m.id,
            parts: m.parts,
            role: m.role,
            metadata: m.metadata,
          })),
        }),
        headers,
      });

      if (!resp.ok) {
        const error = await resp.text();
        throw new Error(error);
      }

      stream = resp
        .body!.pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .pipeThrough(
          new TransformStream({
            async transform(chunk, controller) {
              if (chunk.data === "[DONE]") {
                return;
              }
              try {
                const result = JSON.parse(chunk.data);
                controller.enqueue(result as UIMessageChunk);
              } catch (err) {
                controller.error(err);
                return;
              }
            },
          })
        );
    }
  } catch (err) {
    let error: string | undefined;
    if (signal.aborted) {
      // If an abort occurrs, it's because a new step was created.
      // So we don't want to set an error - the interrupt will
      // already be set.
      error = undefined;
    } else if (err instanceof Error) {
      error = err.message;
    } else {
      error = JSON.stringify(err);
    }
    // If fetch fails, we update the run.
    await db.updateChatRunStep({
      id: step.id,
      chat_run_id: run.id,
      chat_id: id,
      error,
      interrupted_at: signal.aborted ? new Date() : undefined,
      completed_at: new Date(),
    });
    await broadcastChatUpdate();

    // Emit failure log (fire-and-forget)
    writePlatformLog?.({
      agentId: run.agent_id,
      event: {
        type: "blink.request.send_messages",
        level: "error",
        ts: new Date().toISOString(),
        source: "platform",
        message: "Failed to send messages to agent",
        agent: {
          id: run.agent_id,
          deployment_id: deployment.id,
        },
        correlation: {
          chat_id: id,
          run_id: run.id,
          step_id: step.id,
          request_id: reqId,
        },
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return {
      continue: false,
    };
  }

  const responseMessageID = crypto.randomUUID();
  let timeToFirstTokenMicros: number | undefined;
  let error: Error | undefined;
  const streamingResponseMessages = readUIMessageStream({
    stream: stream.pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          if (signal.aborted) {
            return;
          }
          if (timeToFirstTokenMicros === undefined) {
            timeToFirstTokenMicros = Math.round(
              (performance.now() - requestStart) * 1000
            );
          }

          broadcast({
            event: "message.chunk.added",
            data: {
              id: responseMessageID,
              chunk,
            },
          });
          controller.enqueue(chunk);
        },
      }),
      { signal }
    ),
    onError: (err) => {
      error = err instanceof Error ? err : new Error(String(err));
    },
  });

  let responseMessage: UIMessage | null = null;

  const insertResponseMessage = async () => {
    if (!responseMessage) {
      return;
    }
    const createdAt = new Date();
    await db.insertMessages({
      messages: [
        {
          id: responseMessageID,
          created_at: createdAt,
          chat_id: step.chat_id,
          role: "assistant",
          parts: responseMessage.parts,
          agent_id: step.agent_id,
          agent_deployment_id: step.agent_deployment_id,
          chat_run_id: step.chat_run_id,
          chat_run_step_id: step.id,
          metadata: responseMessage.metadata as Record<string, string>,
        },
      ],
    });

    await broadcast({
      event: "message.created",
      data: {
        id: responseMessageID,
        chat_id: step.chat_id,
        role: responseMessage?.role,
        parts: responseMessage?.parts ?? [],
        format: "ai-sdk",
        created_at: createdAt.toISOString(),
        metadata: (responseMessage.metadata as Record<string, string>) ?? null,
      },
    });
  };
  try {
    for await (const chunk of streamingResponseMessages) {
      responseMessage = chunk;
    }
  } catch (err) {
    if (err instanceof Error) {
      error = err;
    } else {
      console.warn("An unknown error occurred:", err);
    }
  }

  const stats = getMessageStats(responseMessage);
  if (error || signal.aborted) {
    if (responseMessage) {
      await insertResponseMessage();
    }

    await db.updateChatRunStep({
      id: step.id,
      chat_run_id: run.id,
      chat_id: id,
      error: signal.aborted ? undefined : error?.message,
      interrupted_at: signal.aborted ? new Date() : undefined,
      completed_at: new Date(),
      response_message_id: responseMessage ? responseMessageID : null,
      response_status: 200,
      time_to_first_token_micros: timeToFirstTokenMicros ?? null,
      ...stats,
    });
    await broadcastChatUpdate();
    return {
      continue: false,
    };
  }

  if (responseMessage) {
    await insertResponseMessage();

    if (shouldLoop(responseMessage)) {
      await db.tx(async (tx) => {
        await tx.updateChatRunStep({
          id: step.id,
          chat_run_id: run.id,
          chat_id: step.chat_id,
          completed_at: new Date(),
          continuation_reason: "tool_call",
          response_message_id: responseMessageID,
          response_status: 200,
          time_to_first_token_micros: timeToFirstTokenMicros ?? null,
          ...stats,
        });

        // Insert a new step for the next loop.
        await tx.insertChatRunStep(
          {
            chat_id: step.chat_id,
            chat_run_id: run.id,
            agent_id: run.agent_id,
            agent_deployment_id: deployment.id,
          },
          // This ignores the unique constraint. If someone else
          // created a new step already, that's perfectly fine.
          true
        );
      });

      await broadcastChatUpdate();
      return {
        continue: true,
      };
    }
  }

  await db.updateChatRunStep({
    id: step.id,
    chat_run_id: run.id,
    chat_id: id,
    completed_at: new Date(),
    response_message_id: responseMessage ? responseMessageID : null,
    response_status: 200,
    time_to_first_token_micros: timeToFirstTokenMicros ?? null,
    ...stats,
  });
  await broadcastChatUpdate();

  return {
    continue: false,
  };
}

function startHeartbeat({
  waitUntil,
  db,
  stepId,
}: {
  waitUntil: (promise: Promise<unknown>) => void;
  db: {
    updateChatRunStep: (updates: {
      id: string;
      heartbeat_at: Date;
    }) => Promise<unknown>;
  };
  stepId: string;
}) {
  const beat = async () => {
    try {
      await db.updateChatRunStep({ id: stepId, heartbeat_at: new Date() });
    } catch (err) {
      // noop
    }
  };

  // Kick immediately so slow starts are not marked idle
  waitUntil(beat());
  const interval = setInterval(() => {
    waitUntil(beat());
  }, 30_000);

  return {
    [Symbol.dispose](): void {
      clearInterval(interval);
    },
  } as { [Symbol.dispose](): void };
}

interface MessageStats {
  tool_calls: number;
  tool_calls_completed: number;
  tool_calls_errored: number;
  usage_cost_usd: number | undefined;
  usage_model: string | undefined;
  usage_total_input_tokens: number | undefined;
  usage_total_output_tokens: number | undefined;
  usage_total_tokens: number | undefined;
  usage_total_cached_input_tokens: number | undefined;
}

function getMessageStats(message: UIMessage | null): MessageStats {
  const stats: MessageStats = {
    tool_calls: 0,
    tool_calls_completed: 0,
    tool_calls_errored: 0,
    usage_cost_usd: undefined,
    usage_model: undefined,
    usage_total_input_tokens: undefined,
    usage_total_output_tokens: undefined,
    usage_total_tokens: undefined,
    usage_total_cached_input_tokens: undefined,
  };
  if (!message) {
    return stats;
  }
  for (const part of message.parts) {
    if (isToolUIPart(part)) {
      stats.tool_calls++;
      if (part.state === "output-available") {
        stats.tool_calls_completed++;
      } else if (part.state === "output-error") {
        stats.tool_calls_errored++;
      }
    }
  }

  if (message.metadata) {
    // Check if the metadata is usage data.
    // This is an example of the raw metadata we get back.
    // metadata: {
    //   usage: {
    //     inputTokens: 7181,
    //     outputTokens: 35,
    //     totalTokens: 7216,
    //     cachedInputTokens: 0
    //   },
    //   model: 'claude-sonnet-4-5-20250929',
    //   totalUsage: {
    //     inputTokens: 7181,
    //     outputTokens: 35,
    //     totalTokens: 7216,
    //     cachedInputTokens: 0
    //   }
    // },
    const usageStats = usageStatsSchema.safeParse(message.metadata);
    if (usageStats.success) {
      stats.usage_model = usageStats.data.model;
      stats.usage_total_input_tokens = usageStats.data.totalUsage?.inputTokens;
      stats.usage_total_output_tokens =
        usageStats.data.totalUsage?.outputTokens;
      stats.usage_total_tokens = usageStats.data.totalUsage?.totalTokens;
      stats.usage_total_cached_input_tokens =
        usageStats.data.totalUsage?.cachedInputTokens;
    }
  }

  return stats;
}

const usageStatsSchema = z.object({
  totalUsage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional(),
      cachedInputTokens: z.number().optional(),
    })
    .optional(),
  model: z.string().optional(),
});

function shouldLoop(lastMessage: UIMessage): boolean {
  if (lastMessage.role !== "assistant") {
    return false;
  }
  const lastStepStartIndex = lastMessage.parts.reduce(
    (lastIndex, part, index) => {
      return part.type === "step-start" ? index : lastIndex;
    },
    -1
  );
  const lastStepToolInvocations = lastMessage.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolOrDynamicToolUIPart);

  if (lastStepToolInvocations.length === 0) {
    return false;
  }

  const hasPendingApprovals = lastStepToolInvocations.some(
    (part) =>
      isToolApprovalOutput(part.output) && part.output.outcome === "pending"
  );
  if (hasPendingApprovals) {
    return false;
  }

  return lastStepToolInvocations.every((part) =>
    part.state.startsWith("output-")
  );
}

/**
 * isToolApprovalOutput checks if an output is a tool approval output.
 */
function isToolApprovalOutput(output: unknown): output is ToolApprovalOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "tool-approval"
  );
}
