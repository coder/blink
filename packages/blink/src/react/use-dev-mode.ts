import type { UIMessage } from "ai";
import chalk from "chalk";
import { isToolOrDynamicToolUIPart } from "ai";
import { isToolApprovalOutput } from "../agent/tools";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { join } from "path";
import type { Client, CapabilitiesResponse } from "../agent/client";
import { getDevhookID, createDevhookID, hasDevhook } from "../cli/lib/devhook";
import { createLocalServer, type LocalServer } from "../local/server";
import { isLogMessage, isStoredMessageMetadata } from "../local/types";
import type { BuildLog } from "../build";
import type { ID, UIOptions, UIOptionsSchema } from "../agent/index.browser";
import useOptions from "./use-options";
import useAgent, { type AgentLog, type Agent } from "./use-agent";
import useBundler, { type BundlerStatus } from "./use-bundler";
import useChat, { type UseChat } from "./use-chat";
import useDevhook from "./use-devhook";
import useDotenv from "./use-dotenv";
import useEditAgent from "./use-edit-agent";
import useAuth, { type UseAuth } from "./use-auth";
import type { Logger } from "./use-logger";

export type DevMode = "run" | "edit";

export interface UseDevModeOptions {
  readonly directory: string;
  readonly logger: Logger;
  readonly onBuildStart?: () => void;
  readonly onBuildSuccess?: (result: { duration: number }) => void;
  readonly onBuildError?: (error: BuildLog) => void;
  readonly onEnvLoaded?: (keys: string[]) => void;
  readonly onDevhookConnected?: (url: string) => void;
  readonly onAgentLog?: (log: AgentLog) => void;
  readonly onDevhookRequest?: (request: {
    method: string;
    path: string;
    status: number;
  }) => void;
  readonly onError?: (error: string) => void;
  readonly onModeChange?: (mode: DevMode) => void;
  readonly onAuthChange?: (
    user: import("./use-auth").UserInfo | undefined
  ) => void;
  readonly onLoginUrl?: (url: string, id: string) => void;
}

export interface BuildStatus {
  readonly status: BundlerStatus;
  readonly error: BuildLog | undefined;
  readonly entrypoint: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
}

export interface DevhookStatus {
  readonly connected: boolean;
  readonly url: string | undefined;
}

export interface AgentOptions {
  readonly schema: UIOptionsSchema<UIOptions> | undefined;
  readonly selected: UIOptions | undefined;
  readonly error: Error | undefined;
  readonly setOption: (id: string, value: string) => void;
}

export interface ApprovalRequest {
  readonly message: UIMessage;
  readonly approve: (autoApprove?: boolean) => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly autoApproveEnabled: boolean;
}

export interface UseDevMode {
  // Mode
  readonly mode: DevMode;
  readonly setMode: (mode: DevMode) => void;
  readonly toggleMode: () => void;

  // Chat
  readonly chat: UseChat;
  readonly chats: ID[];
  readonly switchChat: (id: ID) => void;
  readonly newChat: () => void;

  // Build status
  readonly build: BuildStatus;

  // Devhook
  readonly devhook: DevhookStatus;

  // Agent capabilities
  readonly capabilities: CapabilitiesResponse | undefined;

  // Options
  readonly options: AgentOptions;

  // Approval (if any tool needs approval)
  readonly approval: ApprovalRequest | undefined;

  // Token usage from latest response
  readonly tokenUsage: TokenUsage | undefined;

  // Authentication
  readonly auth: UseAuth;

  // Internal - exposed for advanced use cases
  readonly server: LocalServer;

  // Whether to show the waiting for response placeholder...
  readonly showWaitingPlaceholder: boolean;

  // Whether edit mode is missing an API key
  readonly editModeMissingApiKey: boolean;
}

/**
 * useDevMode abstracts all the business logic for running/editing an agent.
 * This hook is UI-agnostic and can be used in both TUI and Desktop apps.
 */
export default function useDevMode(options: UseDevModeOptions): UseDevMode {
  const { directory } = options;
  const [autoApprove, setAutoApprove] = useState(false);

  // Mode state
  const [mode, setModeState] = useState<DevMode>("run");
  const modeRef = useRef<DevMode>("run");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const setMode = useCallback(
    (newMode: DevMode) => {
      setModeState(newMode);
      options.onModeChange?.(newMode);
    },
    [options.onModeChange]
  );

  const toggleMode = useCallback(() => {
    setMode(mode === "run" ? "edit" : "run");
  }, [mode, setMode]);

  // Bundler
  const {
    error: buildError,
    status: buildStatus,
    result: buildResult,
    entry: entrypoint,
  } = useBundler({
    directory,
    logger: options.logger,
    onBuildStart: options.onBuildStart,
    onBuildSuccess: options.onBuildSuccess,
    onBuildError: options.onBuildError,
  });

  // Authentication
  const auth = useAuth({
    autoCheck: true,
    onAuthChange: options.onAuthChange,
    onLoginUrl: options.onLoginUrl,
  });

  // Environment
  const dotenv = useDotenv(directory, options.logger);
  const env = useMemo(() => {
    const blinkToken = auth.token;
    const allEnv = {
      ...process.env,
      ...dotenv,
    };
    if (blinkToken) {
      allEnv.BLINK_TOKEN = blinkToken;
    }
    return Object.fromEntries(
      Object.entries(allEnv).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>;
  }, [dotenv, auth.token]);

  // Track env changes
  const lastReportedKeys = useRef<number | undefined>(undefined);
  useEffect(() => {
    const keys = Object.keys(env);
    if (
      keys.length === lastReportedKeys.current ||
      lastReportedKeys.current === undefined
    ) {
      lastReportedKeys.current = keys.length;
      return;
    }
    lastReportedKeys.current = keys.length;
    options.onEnvLoaded?.(keys);
  }, [env, options.onEnvLoaded]);

  // Server - always use run agent for webhook/API handling
  const runAgentRef = useRef<Agent | undefined>(undefined);
  const server = useMemo(() => {
    return createLocalServer({
      port: 0,
      dataDirectory: join(directory, ".blink"),
      getAgent: () => runAgentRef.current,
    });
  }, [directory]);

  // Agent
  const {
    agent,
    logs,
    error: agentError,
    capabilities,
  } = useAgent({
    buildResult,
    env,
    apiServerUrl: server.url,
  });

  // Edit agent
  const {
    agent: editAgent,
    error: editAgentError,
    missingApiKey: editModeMissingApiKey,
    setUserAgentUrl,
  } = useEditAgent({
    directory,
    apiServerUrl: server.url,
    env,
    getDevhookUrl: useCallback(() => {
      const id = getDevhookID(directory) ?? createDevhookID(directory);
      setDevhookID(id);
      return `https://${id}.blink.host`;
    }, [directory]),
  });

  // Chat state
  const [chatId, setChatId] = useState<ID>(
    "00000000-0000-0000-0000-000000000000"
  );

  // Update run agent ref for server/webhook handling
  useEffect(() => {
    runAgentRef.current = agent;
  }, [agent]);

  // Update edit agent with user agent URL and handle cleanup
  useEffect(() => {
    if (agent) {
      setUserAgentUrl(agent.client.baseUrl);
    }

    // Stop streaming when agents become unavailable
    if (mode === "run" && !agent) {
      const manager = server.getChatManager(chatId);
      manager?.stopStreaming();
    } else if (mode === "edit" && !editAgent) {
      const manager = server.getChatManager(chatId);
      manager?.stopStreaming();
    }
  }, [agent, editAgent, mode, chatId, server, setUserAgentUrl]);

  // Keep track of selected options in a ref so we can access it in serializeMessage
  const selectedOptionsRef = useRef<UIOptions | undefined>(undefined);

  // Chat hook
  const chat = useChat({
    chatId,
    agent: mode === "run" ? agent : editAgent,
    chatsDirectory: server.chatsDirectory,
    serializeMessage: (msg) => {
      // Tag all messages with the current mode and inject options for user messages
      const metadata =
        msg.role === "user" && selectedOptionsRef.current
          ? {
              ...(typeof msg.metadata === "object" && msg.metadata !== null
                ? msg.metadata
                : {}),
              options: selectedOptionsRef.current,
            }
          : msg.metadata;

      if (typeof metadata === "object" && metadata !== null) {
        // @ts-ignore - This is janky.
        metadata["__blink_mode"] = modeRef.current;
      }

      return {
        id: (msg.id as ID) ?? crypto.randomUUID(),
        created_at: new Date().toISOString(),
        role: msg.role,
        parts: msg.parts,
        mode: modeRef.current,
        metadata,
      };
    },
    filterMessages: (msg) => {
      if (modeRef.current === "edit") {
        // Provide all messages to the edit agent
        return true;
      }

      if (isStoredMessageMetadata(msg.metadata)) {
        return false;
      }
      if (isLogMessage(msg)) {
        return false;
      }
      // Filter out messages created in edit mode
      if (msg.mode === "edit") {
        return false;
      }
      return true;
    },
    onError: (error) => {
      options.onError?.(`${chalk.red("⚙ [Chat Error]")} ${chalk.gray(error)}`);
    },
  });

  // Track agent logs
  const lastLogsLength = useRef(0);
  useEffect(() => {
    if (logs.length === lastLogsLength.current) {
      return;
    }
    const currentLength = lastLogsLength.current;

    for (const log of logs.slice(currentLength)) {
      options.onAgentLog?.(log);

      // Upsert log as an internal message so edit mode can see it
      // chat
      //   .upsertMessage({
      //     id: crypto.randomUUID(),
      //     created_at: new Date().toISOString(),
      //     role: "user",
      //     parts: [
      //       {
      //         type: "text",
      //         text: `[agent ${log.level}] ${log.message}`,
      //       },
      //     ],
      //     mode: modeRef.current,
      //     metadata: undefined,
      //   })
      //   .catch((err) => {
      //     console.error("Error upserting agent log:", err);
      //   });
    }
    lastLogsLength.current = logs.length;
  }, [logs, options.onAgentLog, chat.upsertMessage]);

  // List all chats
  const [chatIds, setChatIds] = useState<ID[]>([]);
  useEffect(() => {
    server.listChats().then((entries) => {
      setChatIds(entries.map((e) => e.key as ID));
    });
  }, [server]);

  // Ensure current chatId is in the list
  useEffect(() => {
    if (chatId && !chatIds.includes(chatId)) {
      setChatIds((prev) => [...prev, chatId]);
    }
  }, [chatId, chatIds]);

  // Devhook
  const [devhookID, setDevhookID] = useState<string | undefined>(() =>
    hasDevhook(directory) ? getDevhookID(directory) : createDevhookID(directory)
  );

  const devhook = useDevhook({
    id: devhookID,
    directory,
    logger: options.logger,
    disabled: !capabilities?.request,
    onRequest: async (request) => {
      if (!agent) {
        throw new Error("No agent");
      }

      // Always send the request to the user's agent (not the edit agent)
      const requestURL = new URL(request.url);
      const agentURL = new URL(agent.client.baseUrl);
      agentURL.pathname = requestURL.pathname;
      agentURL.search = requestURL.search;

      try {
        const response = await fetch(agentURL.toString(), {
          method: request.method,
          body: request.body,
          headers: request.headers,
          redirect: "manual",
          signal: request.signal,
          // @ts-ignore
          duplex: "half",
        });

        // Log webhook request/response
        options.onDevhookRequest?.({
          method: request.method,
          path: requestURL.pathname,
          status: response.status,
        });

        return response;
      } catch (err) {
        options.logger.error(
          "system",
          "Error sending request to user's agent:",
          err
        );
        return new Response("Internal server error", { status: 500 });
      }
    },
  });

  // Notify when devhook connects
  useEffect(() => {
    if (devhook.status !== "connected" || !devhook.url) {
      return;
    }
    options.onDevhookConnected?.(devhook.url);
  }, [devhook.status, devhook.url]);

  // Options
  const {
    schema: optionsSchema,
    options: selectedOptions,
    error: optionsError,
    setOption,
  } = useOptions({
    agent: mode === "run" ? agent?.client : editAgent?.client,
    capabilities,
    messages: chat.messages,
  });

  // Update the options ref whenever selected options change
  useEffect(() => {
    selectedOptionsRef.current = selectedOptions;
  }, [selectedOptions]);

  // Collect all errors with unique keys
  const errors = useMemo(() => {
    const errorMap = new Map<string, string>();

    if (agentError && mode === "run") {
      errorMap.set("agent", agentError.message);
    }
    if (editAgentError && mode === "edit") {
      errorMap.set("editAgent", `Edit agent error: ${editAgentError.message}`);
    }
    if (optionsError) {
      errorMap.set("options", `Options error: ${optionsError.message}`);
    }

    return errorMap;
  }, [agentError, editAgentError, optionsError, mode]);

  // Track previous errors to detect changes
  const prevErrorsRef = useRef<Map<string, string>>(new Map());

  // Report errors only when they change
  useEffect(() => {
    const prev = prevErrorsRef.current;
    const current = errors;

    // Report new or changed errors
    for (const [key, error] of current.entries()) {
      if (prev.get(key) !== error) {
        options.onError?.(error);
      }
    }

    // Clear errors that are gone (report empty string to signal clearing)
    for (const key of prev.keys()) {
      if (!current.has(key)) {
        // Error is gone, but we can't really "clear" it via onError
        // The UI should handle this by checking if errors still exist
      }
    }

    prevErrorsRef.current = new Map(current);
  }, [errors, options.onError]);

  // Approval detection
  const needsApproval = useMemo(() => {
    // Find last assistant message that's not ephemeral
    const lastMessage = [...chat.messages].reverse().find((message) => {
      if (message.role !== "assistant") {
        return false;
      }
      if (message.metadata && (message.metadata as any).ephemeral) {
        return false;
      }
      return true;
    });
    if (!lastMessage) {
      return;
    }
    const parts = lastMessage.parts.filter(isToolOrDynamicToolUIPart);
    if (parts.length === 0) {
      return;
    }
    const should = parts.some(
      (part) =>
        isToolApprovalOutput(part.output) && part.output.outcome === "pending"
    );
    if (should) {
      return lastMessage as UIMessage;
    }
    return undefined;
  }, [chat.messages]);

  const approvalHandledRef = useRef<string | undefined>(undefined);
  const handleApproval = useCallback(
    async (approved: boolean, enableAutoApprove?: boolean) => {
      if (!needsApproval) return;

      // Enable auto-approve if requested
      if (enableAutoApprove && approved) {
        setAutoApprove(true);
      }

      const lastApprovalMessage = chat.messages.reverse().find((msg) => {
        if (msg.role !== "assistant") {
          return false;
        }
        if (!Array.isArray(msg.parts)) {
          return false;
        }
        return msg.parts.some(
          (part) =>
            "output" in part &&
            isToolApprovalOutput(part.output) &&
            part.output.outcome === "pending"
        );
      });

      if (!lastApprovalMessage) {
        return;
      }

      // CRITICAL: all code before this point must be synchronous.
      // Otherwise, the approval may be handled multiple times.
      approvalHandledRef.current = lastApprovalMessage.id;
      // Update all pending approval outputs
      const updatedParts = lastApprovalMessage.parts.map((part: any) => {
        if (
          part.output &&
          isToolApprovalOutput(part.output) &&
          part.output.outcome === "pending"
        ) {
          return {
            ...part,
            output: {
              ...part.output,
              outcome: approved ? "approved" : "rejected",
            },
          };
        }
        return part;
      });

      await chat.upsertMessage({
        ...lastApprovalMessage,
        parts: updatedParts,
      });

      // Restart the agent to process the approval
      await chat.start();
    },
    [needsApproval, chat]
  );

  // Auto-approve if enabled
  useEffect(() => {
    if (autoApprove && needsApproval) {
      handleApproval(true);
    }
  }, [autoApprove, needsApproval, handleApproval]);

  const newChat = useCallback(() => {
    const id = crypto.randomUUID();
    setChatId(id);
    setChatIds((prev) => [...prev, id]);
  }, []);

  const switchChat = useCallback((id: ID) => {
    setChatId(id);
  }, []);

  // Build approval object if needed
  const approval = useMemo((): ApprovalRequest | undefined => {
    if (!needsApproval) return undefined;
    return {
      message: needsApproval,
      approve: (enableAutoApprove?: boolean) =>
        handleApproval(true, enableAutoApprove),
      reject: () => handleApproval(false),
      autoApproveEnabled: autoApprove,
    };
  }, [needsApproval, handleApproval, autoApprove]);

  // Extract token usage from the latest message (only if it's an assistant message)
  const tokenUsage = useMemo((): TokenUsage | undefined => {
    const messages = chat.messages;
    if (messages.length === 0) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== "assistant" || !msg.metadata) {
        continue;
      }
      if (typeof msg.metadata !== "object") {
        continue;
      }
      if (!("totalUsage" in msg.metadata)) {
        continue;
      }
      const totalUsage = msg.metadata.totalUsage;
      if (!totalUsage || typeof totalUsage !== "object") {
        continue;
      }
      if (
        !("inputTokens" in totalUsage) ||
        !("outputTokens" in totalUsage) ||
        !("totalTokens" in totalUsage)
      ) {
        continue;
      }
      return {
        inputTokens: totalUsage.inputTokens as number,
        outputTokens: totalUsage.outputTokens as number,
        totalTokens: totalUsage.totalTokens as number,
        cachedInputTokens: (totalUsage as any)["cachedInputTokens"] as
          | number
          | undefined,
      };
    }

    return undefined;
  }, [chat.messages]);

  const showWaitingPlaceholder = useMemo(() => {
    if (chat.status !== "streaming") {
      return false;
    }
    // We're waiting for a message...
    if (!chat.streamingMessage) {
      return true;
    }
    const toolParts = chat.streamingMessage.parts.filter(
      isToolOrDynamicToolUIPart
    );
    // This is when the tool spinner is no longer spinning,
    // but we're still streaming because it would loop.
    return (
      toolParts.length > 0 &&
      toolParts.every((part) => part.state.startsWith("output-"))
    );
  }, [chat.status, chat.streamingMessage]);

  return {
    mode,
    setMode,
    toggleMode,
    chat,
    chats: chatIds,
    switchChat,
    newChat,
    build: {
      status: buildStatus,
      error: buildError,
      entrypoint,
    },
    devhook: {
      connected: devhook.status === "connected",
      url: devhook.status === "connected" ? devhook.url : undefined,
    },
    capabilities,
    options: {
      schema: optionsSchema,
      selected: selectedOptions,
      error: optionsError,
      setOption,
    },
    approval,
    tokenUsage,
    auth,
    server,
    showWaitingPlaceholder,
    editModeMissingApiKey,
  };
}
