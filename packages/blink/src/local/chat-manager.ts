import { isToolOrDynamicToolUIPart, type UIMessage } from "ai";
import type { Client } from "../agent/client";
import {
  createDiskStore,
  createDiskStoreWatcher,
  type LockedStoreEntry,
  type Store,
} from "./disk-store";
import { runAgent } from "./run-agent";
import {
  convertMessage,
  isStoredMessageMetadata,
  type StoredChat,
  type StoredMessage,
} from "./types";
import type { ID } from "../agent/types";

export type ChatStatus = "idle" | "streaming" | "error";

export interface ChatState {
  readonly id: ID;
  readonly key?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly messages: StoredMessage[];
  readonly status: ChatStatus;
  readonly streamingMessage?: StoredMessage;
  readonly error?: string;
  readonly loading: boolean;
  readonly queuedMessages: StoredMessage[];
}

export interface ChatManagerOptions {
  readonly chatId?: ID;
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
}

type StateListener = (state: ChatState) => void;

/**
 * ChatManager handles all chat state and operations outside of React.
 * This makes it easier to test and reason about race conditions.
 */
export class ChatManager {
  private chatId: ID;
  private agent: Client | undefined;
  private chatStore: Store<StoredChat>;
  private serializeMessage?: (message: UIMessage) => StoredMessage | undefined;
  private filterMessages?: (message: StoredMessage) => boolean;

  private chat: StoredChat;
  private loading = false;
  private streamingMessage: StoredMessage | undefined;
  private status: ChatStatus = "idle";
  private queue: StoredMessage[] = [];
  private abortController: AbortController | undefined;
  private isProcessingQueue = false;

  private listeners = new Set<StateListener>();
  private watcher: ReturnType<typeof createDiskStoreWatcher<StoredChat>>;
  private disposed = false;

  constructor(options: ChatManagerOptions) {
    this.chatId = options.chatId ?? "00000000-0000-0000-0000-000000000000";
    this.chat = {
      id: this.chatId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [],
    };
    this.loading = true;
    this.chatStore = createDiskStore<StoredChat>(options.chatsDirectory, "id");
    this.serializeMessage = options.serializeMessage;
    this.filterMessages = options.filterMessages;

    // Start disk watcher
    this.watcher = createDiskStoreWatcher<StoredChat>(options.chatsDirectory, {
      pollInterval: 1000,
      debounce: 50,
    });

    this.watcher.onChange((event) => {
      if (event.key !== this.chatId) {
        return;
      }

      // During streaming, we handle all state updates.
      // This is to avoid race-conditions or flickering states.
      if (this.isProcessingQueue) {
        return;
      }

      // If file was deleted (value is undefined), clear everything
      if (!event.value) {
        this.chat = {
          id: this.chatId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          messages: [],
        };
        this.status = "idle";
        this.streamingMessage = undefined;
        this.notifyListeners();
        return;
      }

      if (this.chat.updated_at === event.value?.updated_at) {
        // If our local updated at is the same as the disk updated at,
        // we can ignore the event.
        return;
      }

      const diskValue = event.value;

      let newStatus = event.value?.error ? "error" : "idle";
      if (event.locked) {
        newStatus = "streaming";
      }
      const shouldEmit =
        this.chat.updated_at !== diskValue?.updated_at ||
        this.status !== newStatus;

      // Clear persisted errors - they're stale from disk
      this.chat = {
        ...diskValue,
        error: undefined,
      };
      this.streamingMessage = undefined;
      this.status = newStatus as ChatStatus;

      if (shouldEmit) {
        this.notifyListeners();
      }
    });

    // Initial load from disk
    this.chatStore
      .get(this.chatId)
      .then((chat) => {
        if (this.disposed) {
          return;
        }
        // If there's no chat, our state is already accurate.
        if (!chat) {
          return;
        }
        // Clear any persisted errors on load - they're stale
        this.chat = {
          ...chat,
          error: undefined,
        };
      })
      .catch((err) => {
        this.chat.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        this.loading = false;
        this.notifyListeners();
      });
  }

  /**
   * Update the agent instance to be used for chats
   */
  setAgent(agent: Client | undefined): void {
    this.agent = agent;
  }

  /**
   * Get the current state
   */
  public getState(): ChatState {
    return {
      id: this.chatId,
      key: this.chat?.key,
      messages: (this.chat?.messages ?? []).filter(
        (msg) => !isStoredMessageMetadata(msg.metadata)
      ),
      created_at: this.chat?.created_at,
      updated_at: this.chat?.updated_at,
      status: this.status,
      streamingMessage: this.streamingMessage,
      error: this.chat?.error,
      loading: this.loading,
      queuedMessages: this.queue,
    };
  }

  /**
   * Subscribe to state changes
   */
  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Upsert a message to the chat
   */
  async upsertMessages(
    messages: UIMessage[],
    lock?: LockedStoreEntry<StoredChat>
  ): Promise<void> {
    let createdLock = false;
    let locked: LockedStoreEntry<StoredChat> | undefined;
    if (lock) {
      locked = lock;
    } else {
      locked = await this.chatStore.lock(this.chatId);
      createdLock = true;
    }
    try {
      let current = await locked.get();
      if (!current.id || !Array.isArray(current.messages)) {
        // Reset the chat - it's invalid.
        current = {
          id: this.chatId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          messages: [],
        };
      }

      const newMessages: StoredMessage[] = [...current.messages];
      for (const message of messages) {
        let serializedMessage: StoredMessage | undefined;
        if (this.serializeMessage) {
          const result = this.serializeMessage(message);
          // If serializeMessage returns undefined, skip persisting this message
          if (result === undefined) {
            return;
          }
          serializedMessage = result;
        } else {
          serializedMessage = {
            ...message,
            created_at: new Date().toISOString(),
            // Just default to run mode for now.
            mode: "run",
            metadata: message.metadata as any,
            id: (message.id as ID) ?? crypto.randomUUID(),
          };
        }

        const existingMessage = newMessages.findIndex(
          (m) => m.id === serializedMessage.id
        );
        if (existingMessage !== -1) {
          newMessages.splice(existingMessage, 1, serializedMessage);
        } else {
          newMessages.push(serializedMessage);
        }
      }

      this.chat = {
        ...current,
        updated_at: new Date().toISOString(),
        messages: newMessages,
      };
      await locked.set(this.chat);
      this.notifyListeners();
    } finally {
      if (createdLock) {
        await locked.release();
      }
    }
  }

  async deleteMessages(ids: string[]): Promise<void> {
    let locked: LockedStoreEntry<StoredChat> | undefined;
    try {
      locked = await this.chatStore.lock(this.chatId);
      const current = await locked.get();
      this.chat.messages = current.messages.filter((m) => !ids.includes(m.id));
      this.chat.updated_at = new Date().toISOString();
      await locked.set(this.chat);
      this.notifyListeners();
    } finally {
      if (locked) {
        await locked.release();
      }
    }
  }

  /**
   * Send a message to the agent
   */
  async sendMessages(messages: StoredMessage[]): Promise<void> {
    // Clear any previous errors when sending a new message (persist to disk)
    if (this.chat.error) {
      const locked = await this.chatStore.lock(this.chatId);
      try {
        const current = await locked.get();
        this.chat = {
          ...current,
          error: undefined,
          updated_at: new Date().toISOString(),
        };
        await locked.set(this.chat);
      } finally {
        await locked.release();
      }
    }

    this.status = "idle";
    this.notifyListeners();

    // If currently streaming, queue the message
    if (this.isProcessingQueue) {
      this.queue.push(...messages);
      this.notifyListeners();
      return;
    }

    // Otherwise, add to queue and start processing
    this.queue = messages;
    // Do not await this - it will block the server.
    this.processQueueOrRun();
  }

  async start(): Promise<void> {
    // Clear error when explicitly starting
    this.chat.error = undefined;
    this.status = "idle";
    this.notifyListeners();
    // Do not await this - it will block the server.
    this.processQueueOrRun();
  }

  async stop(): Promise<void> {
    this.status = "idle";
    this.abortController?.abort();
    this.notifyListeners();
  }

  private async processQueueOrRun(): Promise<void> {
    if (!this.agent) {
      // Set error state instead of throwing
      this.chat.error =
        "The agent is not available. Please wait for the build to succeed.";
      this.status = "error";
      this.queue = []; // Clear the queue
      this.notifyListeners();
      return;
    }
    if (this.isProcessingQueue) {
      return;
    }
    this.isProcessingQueue = true;
    this.chat.error = undefined;

    let locked: LockedStoreEntry<StoredChat> | undefined;
    try {
      locked = await this.chatStore.lock(this.chatId);
      let first = true;
      while (this.queue.length > 0 || first) {
        first = false;
        // Create a new AbortController for each message
        const controller = new AbortController();
        this.abortController = controller;

        // Get next message from queue
        const nextMessages = [...this.queue];
        this.queue = [];
        this.streamingMessage = undefined;
        this.status = "streaming";
        // Notify listeners immediately so UI shows streaming state
        this.notifyListeners();

        if (nextMessages.length > 0) {
          // upsertMessage notifies listeners.
          await this.upsertMessages(nextMessages, locked);
        }

        let messages = this.chat.messages;
        if (this.filterMessages) {
          messages = messages.filter(this.filterMessages);
        }

        // We apply some jank to fix messages with invalid input.
        // This is arguably a bug with the AI SDK.
        // https://github.com/vercel/ai/issues/8815
        messages = messages.map((msg) => {
          return {
            ...msg,
            parts: msg.parts.map((part) => {
              if (!isToolOrDynamicToolUIPart(part)) {
                return part;
              }
              if (part.input !== "") {
                return part;
              }
              return {
                ...part,
                input: {},
              };
            }),
          };
        });

        // Stream agent response
        const streamStartTime = performance.now();
        const stream = await runAgent({
          agent: this.agent,
          id: this.chatId as ID,
          signal: controller.signal,
          messages,
        });

        const addMessage = async (message: UIMessage) => {
          // Apply serializeMessage if provided
          let serialized: StoredMessage | UIMessage = message;
          if (this.serializeMessage) {
            const result = this.serializeMessage(message);
            // If serializeMessage returns undefined, skip persisting this message
            if (result === undefined) {
              return;
            }
            serialized = result;
          }

          this.chat.updated_at = new Date().toISOString();
          this.chat.messages.push(serialized as StoredMessage);
          this.streamingMessage = undefined;
          await locked?.set(this.chat);
        };

        // Consume the stream and update UI in real-time
        const reader = stream.getReader();
        // We need to cancel the reader immediately on abort.
        controller.signal.addEventListener(
          "abort",
          () => {
            reader.cancel().catch(() => {
              // Ignore cancel errors
            });
          },
          { once: true }
        );

        let ttft: number | undefined;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (controller.signal.aborted) {
              break;
            }

            // Track TTFT on first chunk
            if (!ttft) {
              ttft = performance.now() - streamStartTime;
            }

            if (
              this.streamingMessage &&
              value.id !== this.streamingMessage.id
            ) {
              // The last streaming message was replaced a new message
              // has come in from the loop!
              await addMessage(this.streamingMessage);
            }

            // Inject TTFT into message metadata
            const messageWithTTFT = {
              ...value,
              metadata: {
                ...(typeof value.metadata === "object" &&
                value.metadata !== null
                  ? value.metadata
                  : {}),
                ttft,
              },
            };

            this.streamingMessage = this.serializeMessage
              ? (this.serializeMessage(messageWithTTFT) as StoredMessage)
              : (messageWithTTFT as StoredMessage);
            this.notifyListeners();
          }
        } finally {
          reader.releaseLock();
        }

        if (this.streamingMessage) {
          await addMessage(this.streamingMessage);
        }
      }
    } catch (err: any) {
      this.chat.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.isProcessingQueue = false;
      this.streamingMessage = undefined;
      if (this.chat.error) {
        this.status = "error";
      } else {
        this.status = "idle";
      }

      if (locked) {
        this.chat.updated_at = new Date().toISOString();
        await locked.set(this.chat);
        await locked.release();
        this.notifyListeners();
      }
    }
  }

  /**
   * Stop the current streaming operation
   */
  stopStreaming(): void {
    this.abortController?.abort();
  }

  /**
   * Clear all queued messages
   */
  clearQueue(): void {
    this.queue = [];
    this.notifyListeners();
  }

  /**
   * Reset the chat (delete from disk)
   */
  async resetChat(): Promise<void> {
    // Stop any ongoing streaming first
    this.abortController?.abort();

    // Immediately clear local state for instant UI feedback
    this.resetChatState();
    this.notifyListeners();

    // Delete from disk
    let locked;
    try {
      locked = await this.chatStore.lock(this.chatId);
      await locked.delete();
    } catch (err) {
      // Ignore errors if chat doesn't exist
    } finally {
      if (locked) {
        try {
          await locked.release();
        } catch (err) {
          // Ignore release errors (lock file may already be gone)
        }
      }
    }
  }

  /**
   * Dispose of the manager (cleanup)
   */
  dispose(): void {
    this.disposed = true;
    this.watcher.dispose();
    this.listeners.clear();
    this.abortController?.abort();
  }

  private resetChatState(): void {
    this.chat = {
      id: this.chatId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [],
    };
    this.streamingMessage = undefined;
    this.status = "idle";
    this.queue = [];
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
