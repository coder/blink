/**
 * @fileoverview This file contains helpers for working with tools.
 */
import { isAsyncIterable } from "@whatwg-node/server";
import {
  convertToModelMessages,
  createUIMessageStream,
  getToolName,
  isToolUIPart,
  type InferToolInput,
  type InferToolOutput,
  type Tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import { CustomChatResponseError } from "./internal/errors";

/**
 * ToolWithContext is a tool that supports the "withContext" method.
 *
 * @param CONTEXT The context type.
 * @param TOOL The tool type.
 * @returns The tool with the given context.
 */
export type ToolWithContext<CONTEXT, TOOL extends Tool> = TOOL & {
  withContext(context: CONTEXT): TOOL;
};

/**
 * ToolWithApproval is a tool that supports the "autoApprove" method.
 *
 * @param TOOL The tool type.
 * @returns The tool with the given approval.
 */
export type ToolWithApproval<INPUT, OUTPUT> = Tool<INPUT, OUTPUT> & {
  /**
   * autoApprove is a function that can be used to automatically approve
   * an approval tool call based on the input.
   *
   * @param input The input to the tool.
   * @returns Whether the tool call should be approved.
   */
  autoApprove?: (input: INPUT) => Promise<boolean> | boolean;
};

export type ToolSetWithApproval<TOOLS extends ToolSet> = {
  [K in keyof TOOLS]: ToolWithApproval<
    InferToolInput<TOOLS[K]>,
    InferToolOutput<TOOLS[K]>
  >;
};

/**
 * toolWithApproval is a helper for inferring the execute and autoApprove
 * arguments of a tool.
 *
 * @param tool The tool to wrap.
 * @returns The wrapped tool.
 */
export function toolWithApproval<INPUT, OUTPUT>(
  tool: ToolWithApproval<INPUT, OUTPUT>
): ToolWithApproval<INPUT, OUTPUT> {
  return tool;
}

type ToolSetWithPrefix<TOOLS extends ToolSet, PREFIX extends string> = {
  [K in keyof TOOLS as `${PREFIX}${K & string}`]: K extends string
    ? TOOLS[K]
    : never;
};

/**
 * Tools are helpers for managing tools.
 */
export const tools = Object.freeze({
  /**
   * withContext adds context to a set of tools that supports the "withContext" method.
   *
   * @param context
   * @param tools
   * @returns
   */
  withContext<const TOOLS extends ToolsWithContext>(
    tools: TOOLS,
    context: ContextFromTools<TOOLS>
  ): { [K in keyof TOOLS]: Tool } {
    const withTools = {} as { [K in keyof TOOLS]: Tool };
    for (const key of Object.keys(tools) as Array<keyof TOOLS>) {
      const tool = tools[key]!;
      withTools[key] = tool.withContext(context);
    }
    return withTools;
  },

  /**
   * @internal
   * @deprecated Use withContext instead - it's the same thing.
   */
  with<const TOOLS extends ToolsWithContext>(
    tools: TOOLS,
    context: ContextFromTools<TOOLS>
  ): { [K in keyof TOOLS]: Tool } {
    const withTools = {} as { [K in keyof TOOLS]: Tool };
    for (const key of Object.keys(tools) as Array<keyof TOOLS>) {
      const tool = tools[key]!;
      withTools[key] = tool.withContext(context);
    }
    return withTools;
  },

  /**
   * withApproval ensures a set of tools need explicit user approval
   * before they are executed.
   *
   * This works by replacing the execution of all provided tools with
   * special output that interfaces must handle.
   *
   * On approval, the tool will be executed with the verbatim input.
   *
   * @returns Tools that should be sent in `streamText`.
   */
  async withApproval<
    TOOLSET extends ToolSet,
    TOOLS extends ToolSetWithApproval<TOOLSET>,
    MESSAGE extends UIMessage,
  >(options: {
    messages: MESSAGE[];
    tools: TOOLS;
    abortSignal?: AbortSignal;
  }): Promise<TOOLS> {
    const newTools = {} as { [K in keyof TOOLS]: Tool };
    for (const [key, tool] of Object.entries(options.tools)) {
      const originalExecute = tool.execute;
      newTools[key as keyof TOOLS] = {
        ...tool,
        execute: async (input, options) => {
          if (tool.autoApprove && originalExecute) {
            const approved = await tool.autoApprove(input);
            if (approved) {
              return originalExecute(input, options);
            }
          }
          const output: ToolApprovalOutput = {
            type: "tool-approval",
            outcome: "pending",
          };
          return output;
        },
      };
    }

    const lastMessage = options.messages[options.messages.length - 1];
    if (!lastMessage?.parts) {
      return newTools as TOOLS;
    }

    const toolsToRun: Array<{
      toolName: string;
      tool: Tool;
      input: unknown;
      toolCallId: string;
    }> = [];
    for (const part of lastMessage.parts) {
      // Here we check if we need to run any approvals.
      if (!isToolUIPart(part)) {
        continue;
      }
      const toolName = getToolName(part);
      const tool = options.tools[toolName];
      if (!tool) {
        continue;
      }
      if (part.state !== "output-available") {
        continue;
      }
      if (!tool.execute) {
        continue;
      }
      if (!isToolApprovalOutput(part.output)) {
        continue;
      }
      if (part.output.outcome === "approved") {
        toolsToRun.push({
          toolName: getToolName(part),
          tool,
          input: part.input,
          toolCallId: part.toolCallId,
        });
      }
    }

    if (toolsToRun.length > 0) {
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          writer.write({
            type: "start-step",
          });
          await Promise.all(
            toolsToRun.map(async (toRun): Promise<void> => {
              if (!toRun.tool.execute) {
                throw new Error("Tool does not support execute.");
              }
              writer.write({
                type: "tool-input-available",
                toolCallId: toRun.toolCallId,
                toolName: toRun.toolName,
                input: toRun.input,
              });
              try {
                const result = await toRun.tool.execute(toRun.input, {
                  toolCallId: toRun.toolCallId,
                  messages: convertToModelMessages(options.messages, {
                    tools: options.tools,
                  }),
                  abortSignal: options.abortSignal,
                });
                let lastOutput = result;
                if (isAsyncIterable(result)) {
                  for await (const chunk of result) {
                    lastOutput = chunk;
                    writer.write({
                      type: "tool-output-available",
                      toolCallId: toRun.toolCallId,
                      output: chunk,
                      preliminary: true,
                    });
                  }
                }
                writer.write({
                  type: "tool-output-available",
                  toolCallId: toRun.toolCallId,
                  output: lastOutput,
                });
              } catch (err) {
                writer.write({
                  type: "tool-output-error",
                  toolCallId: toRun.toolCallId,
                  errorText: err instanceof Error ? err.message : String(err),
                });
              }
            })
          );
          writer.write({
            type: "finish",
          });
        },
      });

      throw new CustomChatResponseError("Executing tools", stream);
    }

    return newTools as TOOLS;
  },

  /**
   * prefix adds a prefix to all the tools in a tool set.
   *
   * @param tools The tool set to prefix.
   * @param prefix The prefix to add to the tools.
   * @returns The prefixed tool set.
   */
  prefix<PREFIX extends string, TOOLS extends ToolSet>(
    tools: TOOLS,
    prefix: PREFIX
  ): ToolSetWithPrefix<TOOLS, PREFIX> {
    const prefixed: ToolSet = {};
    for (const [key, tool] of Object.entries(tools)) {
      prefixed[`${prefix}${key}`] = tool;
    }
    return prefixed as ToolSetWithPrefix<TOOLS, PREFIX>;
  },
});

// Structural helper for any tool object that exposes a `withContext(context)` method
type ToolsWithContext = Record<
  string,
  Tool & { withContext(context: unknown): Tool }
>;

export type ContextFromTools<TOOLS extends ToolsWithContext> =
  TOOLS[keyof TOOLS] extends { withContext(context: infer C): any } ? C : never;

/**
 * ToolApprovalOutput is the output of a tool that requires approval.
 *
 * This should be consumed by the UI to display an approval prompt.
 */
export interface ToolApprovalOutput {
  type: "tool-approval";
  outcome: "pending" | "approved" | "rejected";
  reason?: string;
}

/**
 * isToolApprovalOutput checks if an output is a tool approval output.
 */
export function isToolApprovalOutput(
  output: unknown
): output is ToolApprovalOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "tool-approval"
  );
}
