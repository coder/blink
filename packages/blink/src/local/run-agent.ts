import {
  isToolOrDynamicToolUIPart,
  readUIMessageStream,
  type UIMessage,
} from "ai";
import { Client } from "../agent/client";
import { isToolApprovalOutput } from "../agent/tools";
import type { ID } from "../agent/types";

export async function runAgent({
  id,
  agent,
  messages,
  signal,
  shouldContinueStreaming = defaultShouldContinueStreaming,
}: {
  id: ID;
  agent: Client;
  messages: UIMessage[];
  signal?: AbortSignal;

  /**
   * Optionally control when to continue streaming.
   * By default, we continue streaming until the last message
   * is an assistant message and all tool calls have been completed.
   */
  shouldContinueStreaming?: (lastMessage: UIMessage) => boolean;
}): Promise<ReadableStream<UIMessage>> {
  // Make sure we duplicate the array so we can mutate it.
  messages = [...messages];
  const transform = new TransformStream<UIMessage, UIMessage>();
  const writer = transform.writable.getWriter();

  const loop = async () => {
    let lastMessage: UIMessage | undefined;

    try {
      const stream = await agent.chat(
        {
          messages,
          id,
        },
        {
          signal,
        }
      );

      const messageStream = readUIMessageStream({
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [],
          metadata: {},
        },
        stream,
        onError: (error) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          writer.abort(error);
        },
      });

      // Stream all messages WITHOUT persisting intermediate states
      // This prevents duplicate message bug where watcher picks up
      // persisted message while streamingMessage is also being displayed
      for await (const message of messageStream) {
        writer.write(message);
        lastMessage = message;
      }

      // Only persist after streaming completes
      if (lastMessage && shouldContinueStreaming(lastMessage)) {
        messages.push(lastMessage);
        await loop();
        return;
      }
      await writer.close();
    } catch (error: any) {
      // If aborted, save partial message and close gracefully
      if (error?.name === "AbortError" || signal?.aborted) {
        return;
      }
      await writer.abort(error);
    } finally {
      await writer.close();
    }
  };

  loop().catch((error) => {
    writer.abort(error);
  });

  return transform.readable;
}

const defaultShouldContinueStreaming = (lastMessage: UIMessage) => {
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
};
