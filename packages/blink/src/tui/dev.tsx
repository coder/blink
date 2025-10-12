import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";
import chalk from "chalk";
import { Box, Spacer, Static, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { relative } from "path";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isToolApprovalOutput } from "../agent/tools";
import useDevMode, { type TokenUsage } from "../react/use-dev-mode";
import Markdown from "./components/markdown";
import TextInput, {
  KeypressProvider,
  type SlashCommand,
} from "./components/text-input";
import useTerminalSize from "./hooks/use-terminal-size";
import { render } from "ink";
import type { StoredMessage } from "../local/types";
import type { ID } from "../agent/types";

const colors = {
  run: "#1f86ed",
  edit: "#e8900e",
} as const;

export async function startDev({ directory }: { directory: string }) {
  const instance = render(
    <KeypressProvider>
      <Root directory={directory} />
    </KeypressProvider>,
    {
      exitOnCtrlC: false,
    }
  );
  await instance.waitUntilExit();
}

const Root = ({ directory }: { directory: string }) => {
  const size = useTerminalSize();

  // Use the shared dev mode hook
  const dev = useDevMode({
    directory,
    onBuildStart: () => {
      console.log(chalk.gray(`⚙ Compiling...`));
    },
    onBuildSuccess: (result) => {
      console.log(
        chalk.green(`⚙ Compiled in ${Math.round(result.duration)}ms`)
      );
    },
    onBuildError: (error) => {
      console.log(
        chalk.red(`⚙ ${error.message}${error.file ? ` (${error.file})` : ""}`)
      );
    },
    onEnvLoaded: (keys) => {
      let keysText = keys.map((key) => chalk.dim(key)).join(", ");
      if (keysText.length === 0) {
        keysText = chalk.dim("(none)");
      }
      console.log(chalk.gray("⚙ Loaded .env.local:"), keysText);
    },
    onDevhookConnected: (url) => {
      console.log(chalk.gray(`⚙ Send webhooks from anywhere: ${url}`));
    },
    onAgentLog: (log) => {
      const logColor = log.level === "error" ? "red" : "white";
      console.log(chalk[logColor](`@ ${log.message}`));
    },
    onDevhookRequest: (request) => {
      console.log(
        chalk.blue(`↩ `) +
          chalk.gray(
            `method=${request.method} path=${request.path} status=${request.status}`
          )
      );
    },
    onError: (error) => {
      console.log(chalk.red(`⚙ ${error}`));
    },
    onModeChange: (mode) => {
      switch (mode) {
        case "edit":
          console.log(
            chalk.hex(colors.edit).bold(`✎ entering edit mode`) + "\n"
          );
          break;
        case "run":
          console.log(chalk.hex(colors.run).bold(`⟳ entering run mode`) + "\n");
          break;
      }
    },
  });

  const { exit } = useApp();
  const [exitArmed, setExitArmed] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  useInput(async (input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      if (exitArmed) {
        exit();
        return;
      }
      setExitArmed(true);
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
      }
      exitTimerRef.current = setTimeout(() => setExitArmed(false), 2000);
    }

    if (key.ctrl && input === "r") {
      await dev.chat.resetChat();
      resetTerminal();
    }
    if (key.ctrl && input === "e") {
      dev.toggleMode();
    }
    if (key.ctrl && input === "n") {
      dev.newChat();
    }
    if (key.escape) {
      dev.chat.stopStreaming();
    }
  });

  const keymaps = useMemo(() => {
    return {
      "⏎": "send",
      "Ctrl+E": "toggle mode",
      "Ctrl+N": "new chat",
      "Ctrl+C": "quit",
    };
  }, []);

  const keybindSuggestion = useMemo(() => {
    if (exitArmed) {
      return "Ctrl+C again to quit";
    }
    if (dev.chat.queuedMessages.length > 0) {
      return `${dev.chat.queuedMessages.length} message(s) queued - Press [Escape] to stop and process queue`;
    }
    if (dev.chat.status === "streaming") {
      return "Press [Escape] to stop the agent!";
    }
    return undefined;
  }, [exitArmed, dev.chat.status, dev.chat.queuedMessages.length]);

  const { write } = useStdout();
  const [epoch, setEpoch] = useState(0);
  const resetTerminal = useCallback(() => {
    write("\x1Bc"); // Full terminal reset
    write("\x1B[?25l"); // Hide cursor
    setEpoch((prev) => prev + 1);
  }, [write]);

  const initialSizeRef = useRef<{ columns: number; rows?: number }>(size);
  useEffect(() => {
    if (
      initialSizeRef.current.columns !== size.columns ||
      initialSizeRef.current.rows !== size.rows
    ) {
      resetTerminal();
      initialSizeRef.current = size;
    }
  }, [size.columns, size.rows, resetTerminal]);

  useEffect(() => {
    resetTerminal();
  }, [dev.chat.id, resetTerminal]);

  const optionCommand = useMemo((): SlashCommand | undefined => {
    if (!dev.options.schema) {
      return undefined;
    }
    return {
      name: "option",
      description: "Adjust your agent's options.",
      action: () => {
        // noop
      },
      completion: async () => {
        return Object.keys(dev.options.schema!);
      },
      subcommands: Object.entries(dev.options.schema).map(
        ([key, value]): SlashCommand => ({
          name: key,
          description: value.label ?? "",
          action: (args: string) => {
            dev.options.setOption(key, args);
          },
          completion: async (partialArg: string) => {
            return value.values.map((v) => v.id);
          },
        })
      ),
    };
  }, [dev.options]);

  if (dev.chat.loading) {
    return null;
  }

  return (
    <>
      {dev.chat.error ? (
        <Box marginTop={1}>
          <Text color="red">{dev.chat.error}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column">
        <Static
          key={`messages-${dev.chat.id}-${epoch}`}
          items={[{} as StoredMessage, ...dev.chat.messages]}
        >
          {(message: StoredMessage, index) =>
            index === 0 ? (
              <Box key="banner" flexDirection="column" marginBottom={1}>
                <Box>
                  <Text bold>blink■</Text>
                  <Text color="gray"> agent development</Text>
                </Box>
                <Box marginTop={1} flexDirection="column">
                  <Text color="gray">
                    Edit {dev.build.entrypoint} to hot-reload your agent.
                  </Text>
                  <Text color="gray">
                    Run <Text color="blue">blink deploy</Text> to use your agent
                    in the cloud.
                  </Text>
                </Box>
              </Box>
            ) : (
              <Message
                key={message.id}
                message={message}
                previousMessage={
                  // These indices are off by one because of the banner's first message.
                  index > 1 ? dev.chat.messages.at(index - 2) : undefined
                }
                nextMessage={
                  index < dev.chat.messages.length - 2
                    ? dev.chat.messages.at(index + 2)
                    : undefined
                }
                maxWidth={size.columns - 2}
              />
            )
          }
        </Static>

        {dev.chat.streamingMessage ? (
          <Message
            key={dev.chat.streamingMessage.id}
            message={dev.chat.streamingMessage}
            nextMessage={undefined}
            previousMessage={
              dev.chat.messages.length > 0
                ? dev.chat.messages.at(dev.chat.messages.length - 1)
                : undefined
            }
            streaming
            maxWidth={size.columns - 2}
          />
        ) : null}
        {dev.showWaitingPlaceholder ? (
          <AssistantWaitingPlaceholder maxWidth={size.columns - 2} />
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {dev.approval ? (
          <ApprovalInput
            onConfirm={dev.approval.approve}
            onCancel={() => {}}
            autoApproveEnabled={dev.approval.autoApproveEnabled}
          />
        ) : (
          <TextInput
            borderColor={colors[dev.mode]}
            slashCommands={[
              {
                name: "help",
                description: "Show help information",
                action: () => {
                  getHelpText(dev.build.entrypoint).forEach((line) =>
                    console.log(line)
                  );
                },
              },
              {
                name: "reset",
                altNames: ["clear"],
                description: "Reset the chat",
                action: async () => {
                  await dev.chat.resetChat();
                  resetTerminal();
                },
              },
              {
                name: "switch",
                description: "Switch to a different chat",
                action: (args: string) => {
                  dev.switchChat(args as ID);
                },
                completion: async (partialArg: string) => {
                  return dev.chats.filter((id) => id.startsWith(partialArg));
                },
              },
              {
                name: "new",
                description: "Create a new chat",
                action: (args: string) => {
                  dev.switchChat(args as ID);
                },
              },
              {
                name: "edit",
                description: "Switch to Edit mode (AI helps build your agent)",
                action: () => {
                  dev.chat.stopStreaming();
                  dev.setMode("edit");
                },
              },
              {
                name: "run",
                description: "Switch to Run mode (use your agent)",
                action: () => {
                  dev.chat.stopStreaming();
                  dev.setMode("run");
                },
              },
              ...(optionCommand ? [optionCommand] : []),
            ]}
            onSubmit={(value) => {
              dev.chat.sendMessage({
                id: crypto.randomUUID(),
                role: "user",
                parts: [{ type: "text", text: value }],
                created_at: new Date().toISOString(),
                metadata: undefined,
                mode: dev.mode,
              });
              return true;
            }}
            onLayoutChange={() => {
              // We could reset the terminal here to fix the extra
              // space added by the slash command.
              //
              // It looks a bit janky, though.
            }}
          />
        )}
      </Box>

      <Box>
        <Box marginLeft={2} gap={3}>
          <Text color="gray">
            mode: <Text color={colors[dev.mode]}>{dev.mode}</Text>
          </Text>
          <Text color="gray">
            chat: <Text>{dev.chat.id}</Text>
          </Text>
        </Box>

        <Spacer />

        {keybindSuggestion ? (
          <Text color="yellow">{keybindSuggestion + "  "}</Text>
        ) : (
          <Box gap={3} marginRight={2}>
            {Object.entries(keymaps).map(([key, value]) => (
              <Text key={key}>{chalk.gray.dim(key + " " + value)}</Text>
            ))}
          </Box>
        )}
      </Box>

      {dev.tokenUsage || (dev.options.schema && dev.options.selected) ? (
        <Box marginLeft={2} gap={3}>
          {dev.tokenUsage ? (
            <Box gap={1}>
              <Text color="gray">tokens:</Text>
              <Text color="cyan">
                {formatTokenCount(dev.tokenUsage.inputTokens)}
              </Text>
              <Text color="gray">→</Text>
              <Text color="green">
                {formatTokenCount(dev.tokenUsage.outputTokens)}
              </Text>
              {dev.tokenUsage.cachedInputTokens !== undefined &&
              dev.tokenUsage.cachedInputTokens > 0 ? (
                <Text>
                  <Text color="gray">(</Text>
                  <Text color="blue">
                    {formatTokenCount(dev.tokenUsage.cachedInputTokens)}
                  </Text>
                  <Text color="gray"> cached)</Text>
                </Text>
              ) : null}
            </Box>
          ) : null}

          {dev.options.schema && dev.options.selected ? (
            <Box gap={1}>
              <Text color="gray">options:</Text>
              {Object.entries(dev.options.selected).map(([key, value]) => {
                const option = dev.options.schema![key];
                if (!option) {
                  return null;
                }
                return (
                  <Box key={key} gap={0}>
                    <Text color="gray">{key}=</Text>
                    <Text color="gray">{value}</Text>
                  </Box>
                );
              })}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </>
  );
};

const ApprovalInput = ({
  onConfirm,
  onCancel,
  autoApproveEnabled,
}: {
  onConfirm: (approved: boolean, autoApprove?: boolean) => Promise<void>;
  onCancel: () => void;
  autoApproveEnabled: boolean;
}) => {
  const [selected, setSelected] = useState<"yes" | "auto" | "no">("yes");
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  const handleConfirm = React.useCallback(
    async (approved: boolean, autoApprove?: boolean) => {
      if (processingRef.current) return;
      processingRef.current = true;
      setProcessing(true);
      try {
        await onConfirm(approved, autoApprove);
      } catch (err) {
        console.error("Error processing approval:", err);
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [onConfirm]
  );

  const handleCancel = React.useCallback(() => {
    if (processingRef.current) return;
    onCancel();
  }, [onCancel]);

  useInput((input, key) => {
    const lower = input.toLowerCase();

    if (key.escape) {
      handleCancel();
      return;
    }

    if (lower === "y") {
      void handleConfirm(true);
      return;
    }
    if (lower === "a") {
      void handleConfirm(true, true);
      return;
    }
    if (lower === "n") {
      void handleConfirm(false);
      return;
    }

    if (key.leftArrow || key.rightArrow || key.tab) {
      setSelected((prev) => {
        if (prev === "yes") return "auto";
        if (prev === "auto") return "no";
        return "yes";
      });
      return;
    }

    if (key.return) {
      if (selected === "yes") {
        void handleConfirm(true);
      } else if (selected === "auto") {
        void handleConfirm(true, true);
      } else {
        void handleConfirm(false);
      }
    }
  });

  return (
    <Box gap={2} flexDirection="row">
      <Text>
        {processing
          ? "Processing..."
          : autoApproveEnabled
            ? "(auto-approved)"
            : "Approve?"}
      </Text>
      {!processing && !autoApproveEnabled && (
        <>
          <Box>
            <Text>
              [
              <Text
                color={selected === "yes" ? "green" : "gray"}
                bold={selected === "yes"}
              >
                Yes
              </Text>
              /
              <Text
                color={selected === "auto" ? "cyan" : "gray"}
                bold={selected === "auto"}
              >
                Auto
              </Text>
              /
              <Text
                color={selected === "no" ? "red" : "gray"}
                bold={selected === "no"}
              >
                No
              </Text>
              ]
            </Text>
          </Box>
          <Text color="gray">(y/a/n, ←/→ then ⏎)</Text>
        </>
      )}
    </Box>
  );
};

const MessageComponent = ({
  message,
  previousMessage,
  maxWidth,
  streaming,
}: {
  message: StoredMessage;
  previousMessage?: UIMessage;
  nextMessage?: UIMessage;
  maxWidth?: number;
  streaming?: boolean;
}) => {
  let prefix: React.ReactNode;
  let contentColor: string;
  // Only add margin if there is a previous message.
  // Otherwise, we end up with two blank lines under the banner.
  let marginTop: number = previousMessage ? 1 : 0;

  switch (message.role) {
    case "system":
      prefix = <Text>t </Text>;
      contentColor = "gray";
      break;
    case "user":
      prefix = (
        <Text color="magenta" bold>
          ▎
        </Text>
      );
      contentColor = "gray";
      break;
    case "assistant":
      // Use orange prefix for edit mode messages
      const isEditMode = message.mode === "edit";
      prefix = (
        <Text color={isEditMode ? colors.edit : colors.run}>{"> "}</Text>
      );
      contentColor = "white";
      break;
  }

  let content: React.ReactNode = (
    <Box gap={1} flexDirection="column" width={maxWidth}>
      {message.parts
        .map((part, index) => {
          if (part.type === "text") {
            return (
              <Markdown
                id={message.id}
                key={index}
                maxWidth={maxWidth}
                streaming={streaming}
              >
                {part.text}
              </Markdown>
            );
          }

          if (part.type === "reasoning") {
            return (
              <Text key={index} color="gray">
                Reasoning: {part.text}
              </Text>
            );
          }

          if (isToolOrDynamicToolUIPart(part)) {
            return (
              <ToolCall
                key={index}
                part={part}
                maxWidth={maxWidth}
                streaming={streaming}
              />
            );
          }
        })
        .filter(Boolean)}
    </Box>
  );

  return (
    <Box marginTop={marginTop} flexDirection="row">
      <Box>
        <Text color={contentColor}>{prefix}</Text>
      </Box>
      {content}
    </Box>
  );
};

const Message = React.memo(MessageComponent, (prev, next) => {
  if (prev.maxWidth !== next.maxWidth) {
    return false;
  }
  // Messages are only appended; they are never edited in place.
  // This might be irrelevant now with the use of `Static`.
  if (
    prev.nextMessage &&
    next.nextMessage &&
    prev.nextMessage.id === next.nextMessage.id
  ) {
    return true;
  }
  return false;
});

const AssistantWaitingPlaceholder = ({ maxWidth }: { maxWidth?: number }) => {
  return (
    <Box marginTop={1} flexDirection="row">
      <Box>
        <Text color="white">{null}</Text>
      </Box>
      <Box width={maxWidth}>
        <Text color="gray">
          <Spinner /> Waiting for response...
        </Text>
      </Box>
    </Box>
  );
};

const ToolCall = ({
  part,
  maxWidth,
  streaming,
}: {
  part: DynamicToolUIPart | ToolUIPart;
  maxWidth?: number;
  streaming?: boolean;
}) => {
  const name = getToolOrDynamicToolName(part);

  const input = useMemo(() => {
    const labels: Record<string, string> = {};
    if (typeof part.input !== "object" || part.input === null) {
      return labels;
    }
    Object.entries(part.input).forEach(([key, value]) => {
      labels[key] = JSON.stringify(value);
    });
    return labels;
  }, [part]);

  const state = useMemo(() => {
    switch (part.state) {
      case "input-available":
      case "input-streaming":
        if (streaming) {
          return "streaming";
        }
        return "error";
      case "output-available":
        if (
          isToolApprovalOutput(part.output) &&
          part.output.outcome === "pending"
        ) {
          return "pending-approval";
        }
        return "done";
      case "output-error":
        return "error";
    }
  }, [part, streaming]);

  const output = useMemo((): undefined | string | Record<string, string> => {
    if (isToolApprovalOutput(part.output)) {
      return {
        state: part.output.outcome,
      };
    }
    if (!part.output) {
      return undefined;
    }
    if (typeof part.output === "string") {
      return part.output;
    }
    const labels: Record<string, string> = {};
    if (Array.isArray(part.output)) {
      part.output.forEach((item, index) => {
        labels[`${index}`] = JSON.stringify(item);
      });
    } else if (typeof part.output === "object") {
      Object.entries(part.output).forEach(([key, value]) => {
        labels[key] = JSON.stringify(value);
      });
    }
    return labels;
  }, [part, state]);

  const error = useMemo(() => {
    if (part.state !== "output-error") {
      return undefined;
    }
    return part.errorText;
  }, [part]);

  const icon = useMemo(() => {
    switch (state) {
      case "done":
      case "error":
        return "⚒";
      case "pending-approval":
        return "⧗";
    }
    return <Spinner type="dots" />;
  }, [state]);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={state === "error" ? "red" : "gray"} bold>
          {icon}
        </Text>
        <Text>{name}</Text>
      </Box>
      <Box
        marginLeft={2}
        flexDirection="column"
        overflowX="hidden"
        width={maxWidth ? maxWidth - 4 : undefined}
        gap={0}
      >
        <Text color="gray" bold>
          Input:
        </Text>
        {Object.entries(input).map(([key, value]) => (
          <Box key={key} marginLeft={2}>
            <Text color="gray">{key}</Text>
            <Text color="blackBright">=</Text>
            <Box
              width={maxWidth ? maxWidth - 6 - 1 - 2 - key.length : undefined}
            >
              <Text wrap="truncate-middle">{value}</Text>
            </Box>
          </Box>
        ))}

        {output && (
          <>
            <Text color="gray" bold>
              Output:
            </Text>
            {typeof output === "string" ? (
              <Box marginLeft={2}>
                <Text>{output}</Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                {Object.entries(output).map(([key, value]) => (
                  <Box key={key} marginLeft={2}>
                    <Text color="gray">{key}</Text>
                    <Text color="blackBright">=</Text>
                    <Box
                      width={
                        maxWidth ? maxWidth - 6 - 1 - key.length : undefined
                      }
                    >
                      <Text wrap="truncate-middle">{value}</Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}

        {error && (
          <>
            <Text color="gray" bold>
              Error:
            </Text>
            <Text color="red">{error}</Text>
          </>
        )}
      </Box>
    </Box>
  );
};

/**
 * Generate help text for building agents in Blink
 */
function getHelpText(entrypoint: string): string[] {
  return [
    "",
    chalk.bold("How to Build Your Agent"),
    "",
    "Blink has two modes that work together to help you build and test agents:",
    "",
    chalk.hex(colors.edit).bold("  Edit Mode") +
      " - AI helps you build your agent",
    "    • Describe the agent you want to build",
    "    • The AI will modify your agent code based on your instructions",
    `    • Changes are written to ${relative(process.cwd(), entrypoint)} and auto-reload`,
    "",
    chalk.blue.bold("  Run Mode") + " - Use your agent",
    "    • Chat with your agent to see how it behaves",
    "    • Discover what works and what needs improvement",
    "",
    chalk.bold("The Development Loop:"),
    "  1. Start in " +
      chalk.hex(colors.edit)("Edit mode") +
      " (Ctrl+E or /edit) and describe what your agent should do",
    '     Example: "Add a tool that can search the web"',
    "",
    "  2. Switch to " +
      chalk.blue("Run mode") +
      " (Ctrl+E or /run) to use your agent",
    "     Try it out and see if it does what you expect",
    "",
    "  3. Toggle back to " +
      chalk.hex(colors.edit)("Edit mode") +
      " to refine based on what you learned",
    "     The edit AI can see the entire chat history, including your conversations!",
    '     Example: "The search tool failed when I asked about X"',
    "",
    "  4. Repeat until your agent works perfectly",
    "",
    "  5. Deploy with " + chalk.bold("blink deploy") + " when ready",
    "",
    chalk.dim(
      "Tip: Use /reset to start fresh, /new to create separate test chats"
    ),
  ];
}

/**
 * Format large numbers with K/M suffixes
 */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}
