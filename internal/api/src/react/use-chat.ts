import {
  AbstractChat,
  convertFileListToFileUIParts,
  readUIMessageStream,
  type AsyncIterableStream,
  type ChatOnDataCallback,
  type ChatOnErrorCallback,
  type ChatOnFinishCallback,
  type ChatOnToolCallCallback,
  type CreateUIMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import Client, {
  type ChatMessage,
  type SendMessagesRequest,
  type SendMessagesResponse,
  type StreamChatEvent,
} from "../client.browser";

export type UseChatUIHelpers<UI_MESSAGE extends UIMessage> = {
  /**
   * The id of the chat. If not provided, a chat will be created
   * when messages are sent.
   */
  readonly id?: string;

  /**
   * The error object of the chat.
   */
  readonly error: Error | undefined;

  readonly setMessages: (
    messagesParam: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])
  ) => void;
} & Pick<
  AbstractChat<UI_MESSAGE>,
  | "sendMessage"
  | "stop"
  | "addToolResult"
  | "status"
  | "messages"
  | "clearError"
>;

type SendMessageArg<UI_MESSAGE extends UIMessage> = Parameters<
  AbstractChat<UI_MESSAGE>["sendMessage"]
>[0];

export interface UseChatOptions<UI_MESSAGE extends UIMessage> {
  /**
   * A unique identifier for the chat. If not provided,
   * a new chat will be created.
   */
  id?: string;

  /**
   * The id of the organization to use.
   */
  organization: string;

  /**
   * The id of the agent to use.
   */
  agent?: string;

  /**
   * The id of the agent deployment to use.
   */
  agentDeployment?: string;

  /**
   * The messages to initialize the chat with.
   * If not provided, chat history will be inaccurate.
   *
   * Fetch chat history yourself.
   */
  messages?: UI_MESSAGE[];

  /**
   * Initial error message to display (e.g., from persisted chat state).
   */
  initialError?: string;

  client?: Client;

  onError?: ChatOnErrorCallback;
  onToolCall?: ChatOnToolCallCallback<UI_MESSAGE>;
  onFinish?: ChatOnFinishCallback<UI_MESSAGE>;
  onData?: ChatOnDataCallback<UI_MESSAGE>;
}

export function useChat<UI_MESSAGE extends UIMessage>(
  options: UseChatOptions<UI_MESSAGE>
): UseChatUIHelpers<UI_MESSAGE> {
  const clientRef = useRef<Client>(options.client!);
  if (!clientRef.current) {
    clientRef.current = new Client();
  }
  const agentIDRef = useRef<string>(options.agent);
  if (agentIDRef.current !== options.agent) {
    agentIDRef.current = options.agent;
  }
  const organizationIDRef = useRef<string>(options.organization);
  if (organizationIDRef.current !== options.organization) {
    organizationIDRef.current = options.organization;
  }
  const agentDeploymentIDRef = useRef<string | undefined>(
    options.agentDeployment
  );
  if (agentDeploymentIDRef.current !== options.agentDeployment) {
    agentDeploymentIDRef.current = options.agentDeployment;
  }

  const [chatID, setChatID] = useState<string | undefined>(options.id);
  const [messages, setMessages] = useState<UI_MESSAGE[]>(
    options.messages ?? []
  );
  const messagesRef = useRef<UI_MESSAGE[]>(messages);
  const messagesByIDRef = useRef<Map<string, UI_MESSAGE>>(new Map());
  // Initialize map
  messages.forEach((m) => messagesByIDRef.current.set(m.id, m));

  const [status, setStatus] =
    useState<UseChatUIHelpers<UI_MESSAGE>["status"]>("ready");
  const statusRef = useRef<UseChatUIHelpers<UI_MESSAGE>["status"]>(status);
  const [error, setError] = useState<Error | undefined>(
    options.initialError ? new Error(options.initialError) : undefined
  );

  const activeMessageChunkStreamsRef = useRef<
    Map<string, WritableStreamDefaultWriter<UIMessageChunk>>
  >(new Map());

  const chatIDRef = useRef<string | undefined>(chatID);

  // Wrap setChatID to sync chatIDRef immediately (race-free)
  const setChatIDAndSyncRef = useCallback((newChatID: string | undefined) => {
    chatIDRef.current = newChatID;
    setChatID(newChatID);
  }, []);

  // Wrap setMessages to sync refs immediately (race-free)
  const setMessagesAndSyncRefs = useCallback(
    (
      messagesParam: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])
    ) => {
      setMessages((prevMessages) => {
        const nextMessages =
          typeof messagesParam === "function"
            ? messagesParam(prevMessages)
            : messagesParam;

        // Sync refs immediately before render
        messagesRef.current = nextMessages;
        messagesByIDRef.current.clear();
        nextMessages.forEach((m) => messagesByIDRef.current.set(m.id, m));

        return nextMessages;
      });
    },
    []
  );

  // Wrap setStatus to sync statusRef immediately (race-free)
  const setStatusAndSyncRef = useCallback(
    (newStatus: UseChatUIHelpers<UI_MESSAGE>["status"]) => {
      statusRef.current = newStatus;
      setStatus(newStatus);
    },
    []
  );

  const streamRef = useRef<AsyncIterableStream<StreamChatEvent> | undefined>(
    undefined
  );
  const streamAbortRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const connectingRef = useRef(false);
  const manualStopRef = useRef(false);

  const clearActiveChunkWriters = useCallback(() => {
    activeMessageChunkStreamsRef.current.forEach((writer) => {
      writer.close().catch(() => {});
    });
    activeMessageChunkStreamsRef.current.clear();
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (
      !shouldReconnectRef.current ||
      !chatIDRef.current ||
      manualStopRef.current
    ) {
      return;
    }
    const attempt = ++reconnectAttemptRef.current;
    const base = Math.min(10000, 500 * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 200);
    const delay = base + jitter;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      if (
        !streamRef.current &&
        !connectingRef.current &&
        !manualStopRef.current
      ) {
        connect();
      }
    }, delay);
  }, []);

  const disconnect = useCallback(
    (cancelStream: boolean) => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (streamAbortRef.current) {
        try {
          streamAbortRef.current.abort();
        } catch {}
        streamAbortRef.current = null;
      }
      const current = streamRef.current;
      if (current) {
        if (cancelStream) {
          current.cancel().catch(() => {});
        }
        streamRef.current = undefined;
      }
      clearActiveChunkWriters();
    },
    [clearActiveChunkWriters]
  );

  const handleMessageChunk = useCallback(
    async (id: string, message: UIMessageChunk) => {
      if (statusRef.current !== "streaming") {
        setStatusAndSyncRef("streaming");
      }
      let writer = activeMessageChunkStreamsRef.current.get(id);
      if (writer) {
        await writer.write(message);
        return;
      }
      const transform = new TransformStream<UIMessageChunk, UIMessageChunk>();
      writer = transform.writable.getWriter();
      activeMessageChunkStreamsRef.current.set(id, writer);
      const existing = messagesByIDRef.current.get(id);
      readUIMessageStream({
        message: existing,
        stream: transform.readable,
      })
        .pipeTo(
          new WritableStream({
            write: (message) => {
              setMessagesAndSyncRefs((messages) => {
                message.id = id;

                const index = messages.findIndex((m) => m.id === id);
                if (index === -1) {
                  return [...messages, message];
                }
                return [
                  ...messages.slice(0, index),
                  message,
                  ...messages.slice(index + 1),
                ];
              });
            },
          })
        )
        .catch(() => {})
        .finally(() => {
          if (writer) {
            writer.close().catch(() => {});
            activeMessageChunkStreamsRef.current.delete(id);
          }
        });
      await writer.write(message);
    },
    [setStatusAndSyncRef, setMessagesAndSyncRefs]
  );

  const convertMessage = useCallback((message: ChatMessage): UI_MESSAGE => {
    return {
      id: message.id,
      parts: message.parts,
      role: message.role,
      metadata: message.metadata,
    } as UI_MESSAGE;
  }, []);

  const readStream = useCallback(
    async (stream: AsyncIterableStream<StreamChatEvent>) => {
      streamRef.current = stream;
      try {
        for await (const message of stream) {
          switch (message.event) {
            case "message.chunk.added":
              await handleMessageChunk(message.data.id, message.data.chunk);
              break;
            case "message.created":
              setMessagesAndSyncRefs((messages) => {
                const index = messages.findIndex(
                  (m) => m.id === message.data.id
                );
                if (index === -1) {
                  return [...messages, convertMessage(message.data)];
                }
                return [
                  ...messages.slice(0, index),
                  convertMessage(message.data),
                  ...messages.slice(index + 1),
                ];
              });

              const writer = activeMessageChunkStreamsRef.current.get(
                message.data.id
              );
              if (writer) {
                writer.close().catch(() => {});
                activeMessageChunkStreamsRef.current.delete(message.data.id);
              }
              break;
            case "message.updated":
              setMessagesAndSyncRefs((messages) => {
                const index = messages.findIndex(
                  (m) => m.id === message.data.id
                );
                if (index === -1) {
                  return messages;
                }
                return [
                  ...messages.slice(0, index),
                  convertMessage(message.data),
                  ...messages.slice(index + 1),
                ];
              });
              break;
            case "message.deleted":
              setMessagesAndSyncRefs((messages) =>
                messages.filter((m) => m.id !== message.data.id)
              );
              break;
            case "chat.updated": {
              switch (message.data.status) {
                case "streaming":
                  setStatusAndSyncRef("streaming");
                  break;
                case "error":
                  setStatusAndSyncRef("error");
                  setError(new Error(message.data.error ?? "Unknown error"));
                  break;
                case "idle":
                  setStatusAndSyncRef("ready");
                  break;
                case "interrupted":
                  setStatusAndSyncRef("ready");
                  break;
                default:
                  setStatusAndSyncRef("error");
                  setError(
                    new Error(`Unknown chat status: ${message.data.status}`)
                  );
                  break;
              }
            }
          }
        }
      } catch (err) {
        if (shouldReconnectRef.current) {
          setError(err as Error);
        }
      } finally {
        const isCurrent = streamRef.current === stream;
        if (isCurrent) {
          streamRef.current = undefined;
          clearActiveChunkWriters();
          setStatusAndSyncRef("ready");
          if (
            shouldReconnectRef.current &&
            chatIDRef.current &&
            !manualStopRef.current
          ) {
            scheduleReconnect();
          }
        }
      }
    },
    [
      handleMessageChunk,
      convertMessage,
      clearActiveChunkWriters,
      scheduleReconnect,
      setMessagesAndSyncRefs,
      setStatusAndSyncRef,
    ]
  );

  const attachToStream = useCallback(
    (stream: AsyncIterableStream<StreamChatEvent>) => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.cancel().catch(() => {});
      }
      reconnectAttemptRef.current = 0;
      readStream(stream).catch((err) => {
        setError(err);
      });
    },
    [readStream]
  );

  const connect = useCallback(async () => {
    // Check-then-act race fix: set connectingRef immediately
    if (!chatIDRef.current || connectingRef.current || streamRef.current) {
      return;
    }
    connectingRef.current = true;

    // Double-check after setting flag (race-free)
    if (!chatIDRef.current || streamRef.current) {
      connectingRef.current = false;
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const controller = new AbortController();
    streamAbortRef.current = controller;
    try {
      const stream = await clientRef.current.chats.stream(chatIDRef.current, {
        transport: "websocket",
        signal: controller.signal,
      });
      attachToStream(stream);
      reconnectAttemptRef.current = 0;
    } catch (err) {
      setError(err as Error);
      scheduleReconnect();
    } finally {
      connectingRef.current = false;
    }
  }, [attachToStream, scheduleReconnect]);

  useEffect(() => {
    if (!chatID) {
      return;
    }
    if (streamRef.current || connectingRef.current) {
      return;
    }
    connect();
  }, [chatID, connect]);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      disconnect(true);
    };
  }, [disconnect]);

  useEffect(() => {
    const onOnline = () => {
      if (!chatIDRef.current) return;
      reconnectAttemptRef.current = 0;
      if (!streamRef.current && !connectingRef.current) {
        connect();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onOnline();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [connect]);

  const submit = useCallback(
    async (message?: CreateUIMessage<UI_MESSAGE>) => {
      setStatusAndSyncRef("submitted");

      if (!agentIDRef.current) {
        setError(new Error("No agent selected"));
        return;
      }

      if (!message) {
        return;
      }

      const preInsertedIDs: string[] = [];
      const requestMessages: SendMessagesRequest["messages"] = [];
      if (message) {
        requestMessages.push({
          role: message.role ?? "user",
          parts: message.parts,
          metadata: message.metadata as
            | Record<string, string>
            | null
            | undefined,
          format: "ai-sdk",
        });

        const preInsertedID = crypto.randomUUID();
        preInsertedIDs.push(preInsertedID);
        setMessagesAndSyncRefs((messages) => [
          ...messages,
          {
            id: preInsertedID,
            role: message.role ?? "user",
            parts: message.parts,
            metadata: message.metadata as
              | Record<string, string>
              | null
              | undefined,
            format: "ai-sdk",
          } as unknown as UI_MESSAGE,
        ]);
      }

      let responseMessages: SendMessagesResponse["messages"] = [];
      if (chatID) {
        const resp = await clientRef.current.messages.send({
          chat_id: chatID,
          messages: requestMessages,
          behavior: "interrupt",
        });
        responseMessages = resp.messages;
      } else {
        const resp = await clientRef.current.chats.create({
          agent_deployment_id: agentDeploymentIDRef.current,
          agent_id: agentIDRef.current,
          organization_id: organizationIDRef.current,
          messages: requestMessages,
          stream: true,
        });
        setChatIDAndSyncRef(resp.id);
        attachToStream(resp.stream);
        responseMessages = resp.messages;
      }

      // Deduplication: only remove pre-inserted messages if we have server-assigned
      // replacements. For streaming (new chat), responseMessages may be empty since
      // messages arrive via the stream - in that case, keep the pre-inserted message.
      setMessagesAndSyncRefs((messages) => {
        const newResponses = responseMessages
          .filter((rm) => !messagesByIDRef.current.has(rm.id))
          .map((message) => convertMessage(message));

        // Only remove pre-inserted messages if we have replacements
        if (newResponses.length === 0) {
          return messages;
        }

        const kept = messages.filter((m) => !preInsertedIDs.includes(m.id));
        return [...kept, ...newResponses];
      });
    },
    [
      chatID,
      setChatIDAndSyncRef,
      attachToStream,
      convertMessage,
      setStatusAndSyncRef,
      setMessagesAndSyncRefs,
    ]
  );

  return {
    id: chatID,
    error,
    addToolResult: async () => {},
    stop: async () => {
      if (!chatID) {
        return;
      }
      manualStopRef.current = true;
      disconnect(true);
      await clientRef.current.chats.stop(chatID);
      setStatusAndSyncRef("ready");
      // Re-enable reconnection for future user actions
      manualStopRef.current = false;
    },
    clearError: () => {
      setError(undefined);
    },
    messages,
    sendMessage: async (message: SendMessageArg<UI_MESSAGE>) => {
      if (!message) {
        return;
      }

      let uiMessage: CreateUIMessage<UI_MESSAGE>;

      if ("text" in message || "files" in message) {
        const fileParts = Array.isArray(message.files)
          ? message.files
          : await convertFileListToFileUIParts(message.files);

        uiMessage = {
          parts: [
            ...fileParts,
            ...("text" in message && message.text != null
              ? [{ type: "text" as const, text: message.text }]
              : []),
          ],
        } as UI_MESSAGE;
      } else {
        uiMessage = message;
      }

      try {
        await submit(uiMessage);
      } catch (err) {
        console.error(err);
        setError(err as Error);
      }
      setStatusAndSyncRef("streaming");
    },
    status,
    setMessages: setMessagesAndSyncRefs,
  };
}
