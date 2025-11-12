import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Client } from "../agent/client";
import { ChatManager, type ChatState } from "../local/chat-manager";
import type { StoredMessage } from "../local/types";
import type { ID } from "../agent/types";
import type { Agent } from "./use-agent";

export type { ChatStatus } from "../local/chat-manager";

export interface UseChatOptions {
  readonly chatId: ID;
  readonly agent: Agent | undefined;
  readonly chatsDirectory: string;
  /**
   * Optional function to filter messages before persisting them.
   * Return undefined to skip persisting the message.
   */
  readonly serializeMessage?: (message: UIMessage) => StoredMessage | undefined;
  /**
   * Optional function to filter messages before sending to the agent.
   * Return true to include the message, false to exclude it.
   */
  readonly filterMessages?: (message: StoredMessage) => boolean;
  /**
   * Optional callback invoked when an error occurs during chat operations.
   */
  readonly onError?: (error: string) => void;
}

export interface UseChat extends ChatState {
  readonly sendMessage: (message: StoredMessage) => Promise<void>;
  readonly upsertMessage: (message: StoredMessage) => Promise<void>;
  readonly queueLogMessage: ChatManager["queueLogMessage"];
  readonly deleteMessage: (id: string) => Promise<void>;
  readonly stopStreaming: () => void;
  readonly resetChat: () => Promise<void>;
  readonly clearQueue: () => void;
  readonly start: () => Promise<void>;
}

export default function useChat(options: UseChatOptions): UseChat {
  const {
    chatId,
    agent,
    chatsDirectory,
    serializeMessage,
    filterMessages,
    onError,
  } = options;

  // Use a ref to store the manager so it persists across renders
  const managerRef = useRef<ChatManager | null>(null);
  const [state, setState] = useState<ChatState>({
    id: chatId,
    messages: [],
    status: "idle",
    loading: true,
    queuedMessages: [],
    queuedLogs: [],
  });

  // Create manager on mount or when chatId changes
  useEffect(() => {
    // Dispose old manager if chatId changed
    if (managerRef.current) {
      managerRef.current.dispose();
    }

    // Create new manager
    const manager = new ChatManager({
      chatId,
      chatsDirectory,
      serializeMessage,
      filterMessages,
      onError,
    });
    const unsubscribe = manager.subscribe((newState) => {
      setState(newState);
    });

    // Set initial state
    setState(manager.getState());

    managerRef.current = manager;

    return () => {
      unsubscribe();
      manager.dispose();
      managerRef.current = null;
    };
  }, [chatId, chatsDirectory]);

  // Update agent when it changes
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.setAgent(agent);
    }
  }, [agent]);

  // Create stable callback wrappers
  const sendMessage = useCallback(async (message: StoredMessage) => {
    if (managerRef.current) {
      await managerRef.current.sendMessages([message]);
    }
  }, []);

  const upsertMessage = useCallback(async (message: StoredMessage) => {
    if (managerRef.current) {
      await managerRef.current.upsertMessages([message]);
    }
  }, []);

  const queueLogMessage = useCallback<ChatManager["queueLogMessage"]>(
    async (args) => {
      if (managerRef.current) {
        await managerRef.current.queueLogMessage(args);
      }
    },
    []
  );

  const stopStreaming = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.stopStreaming();
    }
  }, []);

  const resetChat = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.resetChat();
    }
  }, []);

  const clearQueue = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.clearQueue();
    }
  }, []);

  const deleteMessage = useCallback(async (id: string) => {
    if (managerRef.current) {
      await managerRef.current.deleteMessages([id]);
    }
  }, []);

  const start = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.start();
    }
  }, []);

  return {
    ...state,
    sendMessage,
    upsertMessage,
    queueLogMessage,
    stopStreaming,
    resetChat,
    clearQueue,
    deleteMessage,
    start,
  };
}
