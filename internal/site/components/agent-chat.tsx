"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Keycap from "@/components/ui/keycap";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatMessagesScroll } from "@/hooks/use-chat-messages-scroll";
import { cn, uuidToSlug } from "@/lib/utils";
import type { Agent } from "@blink.so/api";
import Client from "@blink.so/api";
import { useChat } from "@blink.so/api/react";
import type { UIMessage } from "ai";
import { ChevronsUpDown, MessageSquare, Star, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useRef as useDomRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWRInfinite from "swr/infinite";
import type { ChatMessageInputRef } from "./chat-message-input";
import { ChatMultimodalInput } from "./chat-multimodal-input";
import { CheckCircleFillIcon, LogoBlinkHopping } from "./icons";
import { PreviewMessage } from "./message";
import Avatar from "./ui/avatar";

export type AgentChatProps = {
  id?: string;
  agent?: Agent;
  agentDeployment?: string;
  organization: string;
  messages?: UIMessage[];
  initialError?: string;
  emptyState?: React.ReactNode;
  hideAgentSelector?: boolean;
};

export default function AgentChat({
  id: initialId,
  agent,
  agentDeployment,
  organization,
  messages: initialMessages,
  initialError,
  emptyState,
  hideAgentSelector,
}: AgentChatProps) {
  const client = useMemo(() => new Client(), []);
  const shouldFetchHistory = Boolean(initialId);
  const router = useRouter();
  const pathname = usePathname();

  // If an agent isn't provided, allow the user to pick one from this organization
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    agent?.id ?? null
  );
  const resolvedAgentId = agent?.id ?? selectedAgentId ?? undefined;

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [highlightedAgentIndex, setHighlightedAgentIndex] = useState<number>(0);
  const agentItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Persistent error state (remains until dismissed or new message sent)
  const [displayedChatError, setDisplayedChatError] = useState<Error | null>(
    null
  );
  const [displayedMessagesError, setDisplayedMessagesError] =
    useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingAgents(true);
    setAgentsError(null);
    client.agents
      .list({ per_page: 100 })
      .then((resp) => {
        if (cancelled) return;
        // Sort agents: pinned first, then alphabetically within each group
        const sorted = [...resp.items].sort((a, b) => {
          if (a.pinned !== b.pinned) {
            return a.pinned ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        setAgents(sorted);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentsError(err?.message ?? "Failed to load agents");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAgents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, organization]);

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!agents) return null;
    if (!agentSearchQuery.trim()) return agents;
    const query = agentSearchQuery.toLowerCase();
    return agents.filter((agent) => agent.name.toLowerCase().includes(query));
  }, [agents, agentSearchQuery]);

  // Reset highlighted index when filtered list changes
  useEffect(() => {
    setHighlightedAgentIndex(0);
  }, [filteredAgents]);

  // Scroll highlighted item into view
  useEffect(() => {
    const element = agentItemRefs.current.get(highlightedAgentIndex);
    if (element) {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedAgentIndex]);

  // Keep `selectedAgentId` in sync with the provided agent prop
  useEffect(() => {
    if (agent?.id) {
      setSelectedAgentId(agent.id);
    }
  }, [agent?.id]);

  // Initialize from cookie or auto-select first agent
  useEffect(() => {
    if (agent?.id) return; // Agent provided as prop
    if (selectedAgentId) return; // Already have selection
    if (!agents || agents.length === 0) return; // No agents loaded yet
    if (typeof document === "undefined") {
      // SSR: just auto-select first agent
      setSelectedAgentId(agents[0].id);
      return;
    }

    // Try cookie first
    const cookiePrefix = `chat-agent-${organization}=`;
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(cookiePrefix));

    if (match) {
      const value = match.slice(cookiePrefix.length);
      // Verify the agent from cookie exists in the list
      const agentExists = agents.some((a) => a.id === value);
      if (value && agentExists) {
        setSelectedAgentId(value);
        return;
      }
    }

    // No cookie or invalid cookie: select first agent (already sorted: pinned first, then alphabetical)
    setSelectedAgentId(agents[0].id);
  }, [agent?.id, selectedAgentId, agents, organization]);

  // Scroll container and bottom sentinel from shared hook
  const { containerRef, endRef, isAtBottom, scrollToBottom } =
    useChatMessagesScroll();
  // Top sentinel for loading older pages
  const topRef = useRef<HTMLDivElement>(null);

  // Cursor-paginated history
  const PAGE_SIZE = 30;
  const {
    data: pages,
    error: messagesError,
    isLoading,
    size,
    setSize,
    isValidating,
  } = useSWRInfinite(
    (pageIndex, previousPageData: any) => {
      if (!shouldFetchHistory) return null;
      if (pageIndex === 0) return ["messages", initialId, null];
      const prevCursor = previousPageData?.next_cursor ?? null;
      if (!prevCursor) return null;
      return ["messages", initialId, prevCursor];
    },
    async ([, id, cursor]) => {
      return client.messages.list({
        chat_id: id as string,
        cursor: cursor ?? undefined,
        limit: PAGE_SIZE,
      });
    },
    {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  );

  // Merge paged messages and feed into useChat state without losing local/streaming messages
  const { sendMessage, status, messages, error, id, setMessages, stop } =
    useChat({
      agent: resolvedAgentId,
      agentDeployment,
      organization,
      id: initialId,
      messages: initialMessages,
      initialError,
    });

  // Capture errors from useChat hook
  useEffect(() => {
    if (error) {
      setDisplayedChatError(error);
    }
  }, [error]);

  // Capture errors from message loading
  useEffect(() => {
    if (messagesError) {
      setDisplayedMessagesError(
        messagesError instanceof Error
          ? messagesError
          : new Error(String(messagesError))
      );
    }
  }, [messagesError]);

  // Keep scroll anchored when prepending older pages
  const pendingScrollAdjust = useRef<{
    prevScrollHeight: number;
    prevScrollTop: number;
  } | null>(null);

  // Observe top sentinel to load more when visible
  useEffect(() => {
    const container = containerRef.current;
    const top = topRef.current;
    if (!container || !top) return;

    const onIntersect: IntersectionObserverCallback = (entries) => {
      const entry = entries[0];
      if (!entry.isIntersecting) return;
      const lastPage = pages?.[pages.length - 1];
      const hasMore = Boolean(lastPage?.next_cursor);
      if (!hasMore || isValidating) return;

      // Prepare scroll anchoring
      pendingScrollAdjust.current = {
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
      setSize((s) => s + 1);
    };

    const observer = new IntersectionObserver(onIntersect, {
      root: container,
      rootMargin: "200px 0px 0px 0px",
      threshold: 0.01,
    });
    observer.observe(top);
    return () => observer.disconnect();
  }, [containerRef, topRef, pages, setSize, size, isValidating]);

  // Always start at the bottom on mount
  useEffect(() => {
    scrollToBottom("auto");
  }, [scrollToBottom]);

  // Feed fetched pages into chat state (prepend older messages, dedupe)
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const fetched = pages.flatMap((p) => p.items);
    // API returns newest-first; for flex-col-reverse, newest should be first in the array
    // When loading older pages, we need them at the end of the array
    setMessages((existing) => {
      const newOnes = fetched.filter(
        (m) => !existing.some((e) => e.id === m.id)
      );
      if (newOnes.length === 0) return existing;
      // flex-col-reverse: append older items to the end of the array to keep visual order stable
      return [...newOnes.reverse(), ...existing];
    });
  }, [pages, setMessages]);

  const selectedAgent =
    agents?.find((a) => a.id === selectedAgentId) ?? agent ?? null;

  // Dropdown open state to support hotkeys
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);

  // Input and completion state (POC)
  const [inputText, setInputText] = useState<string>("");
  const [ghostText, setGhostText] = useState<string | undefined>(undefined);
  const completionReqIdRef = useRef(0);
  const messageInputRef = useDomRef<ChatMessageInputRef | null>(null);
  const agentSearchInputRef = useDomRef<HTMLInputElement>(null);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    if (typeof document !== "undefined") {
      document.cookie = `chat-agent-${organization}=${agentId}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }
    setAgentMenuOpen(false);
  };

  // Focus search input when dropdown opens
  useEffect(() => {
    if (agentMenuOpen) {
      // Small delay to ensure portal content is mounted
      const timer = setTimeout(() => {
        agentSearchInputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [agentMenuOpen]);

  // Debounced completions driven by input text
  useEffect(() => {
    if (!resolvedAgentId) {
      setGhostText(undefined);
      return;
    }
    const text = inputText;
    if (!text || !text.trim()) {
      setGhostText(undefined);
      return;
    }

    return;

    // TODO: Enable once we detect whether agents support completions.
    // const currentReq = ++completionReqIdRef.current;
    // let cancelled = false;
    // const timer = setTimeout(async () => {
    //   try {
    //     const stream = await client.agents.completions({
    //       agent_id: resolvedAgentId,
    //       input: text,
    //       caret: text.length,
    //       chat_id: id,
    //       agent_deployment_id: agentDeployment,
    //     });
    //     let suggestion = "";
    //     for await (const chunk of stream) {
    //       if (cancelled || currentReq !== completionReqIdRef.current) return;
    //       if (typeof chunk === "string") {
    //         suggestion = chunk;
    //       } else if (chunk && typeof chunk === "object") {
    //         // @ts-ignore prefer text if present
    //         if (chunk.text) suggestion = chunk.text as string;
    //         // @ts-ignore
    //         else if (chunk.insertText) suggestion = chunk.insertText as string;
    //         // @ts-ignore
    //         else if (chunk.label) suggestion = chunk.label as string;
    //       }
    //       setGhostText(suggestion || undefined);
    //     }
    //   } catch (_) {
    //     console.error("Failed to get completions", _);
    //     setGhostText(undefined);
    //   }
    // }, 200);
    // return () => {
    //   cancelled = true;
    //   clearTimeout(timer);
    // };
  }, [client, resolvedAgentId, agentDeployment, id, inputText]);

  const handleAcceptGhostText = useCallback(() => {
    if (!ghostText) return;
    messageInputRef.current?.insertText(ghostText);
    setGhostText(undefined);
  }, [ghostText]);

  const handleCancelGhostText = useCallback(() => {
    setGhostText(undefined);
    completionReqIdRef.current++;
  }, []);

  // Replace the URL once we have a chat id, then again when the title arrives.
  const lastReplacedIdRef = useRef<string | null>(null);
  const getChatBasePath = (pathname: string): string | null => {
    if (pathname === "/chat" || pathname.startsWith("/chat/")) {
      return "/chat";
    }
    const match = pathname.match(/^((?:\/[^/]+){2}\/chats)(?:\/.*)?$/);
    return match ? match[1] : null;
  };

  useEffect(() => {
    if (!id) return;
    if (lastReplacedIdRef.current === id) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    const base = getChatBasePath(pathname);
    if (!base) return;
    const newUrl = `${base}/${uuidToSlug(id)}${hash || ""}`;
    if (newUrl !== pathname + (hash || "")) {
      console.log("replacing url", newUrl);
      window.history.replaceState(null, "", newUrl);
    }
    lastReplacedIdRef.current = id;
  }, [id, pathname, router]);

  const [options, setOptions] = useState<Record<string, string>>({});

  const adornment = (
    <>
      {!hideAgentSelector && (
        <DropdownMenu open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="md:px-2 md:h-[34px] text-muted-foreground hover:text-foreground hover:bg-transparent gap-2 focus-visible:outline-none"
              type="button"
            >
              {selectedAgent ? (
                <>
                  <Avatar
                    seed={selectedAgent.id}
                    src={selectedAgent.avatar_url}
                    size={16}
                    className="rounded-[4px]"
                  />
                  <span className="max-w-[160px] truncate">
                    {selectedAgent.name}
                  </span>
                </>
              ) : (
                <span className="opacity-80">Select agent</span>
              )}
              <ChevronsUpDown className="opacity-60 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={8}
            avoidCollisions={false}
            className="min-w-[300px] max-w-[350px] h-[40vh] p-0 flex flex-col overflow-hidden"
            onKeyDown={(e) => {
              const key = e.key;
              if (/^[1-9]$/.test(key)) {
                e.preventDefault();
                const index = parseInt(key, 10) - 1;
                const list = filteredAgents ?? [];
                const target = list[index];
                if (target) {
                  handleSelectAgent(target.id);
                }
              }
            }}
          >
            <div className="px-3 py-2 border-b border-sidebar-border">
              <input
                type="text"
                placeholder="Search agents..."
                value={agentSearchQuery}
                onChange={(e) => setAgentSearchQuery(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  const list = filteredAgents ?? [];
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedAgentIndex((prev) =>
                      Math.min(prev + 1, list.length - 1)
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedAgentIndex((prev) => Math.max(prev - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const target = list[highlightedAgentIndex];
                    if (target) {
                      handleSelectAgent(target.id);
                    }
                  } else {
                    e.stopPropagation();
                  }
                }}
                onFocus={(e) => e.stopPropagation()}
                ref={agentSearchInputRef}
                className="w-full px-2 py-1.5 text-xs bg-muted/30 dark:bg-muted/50 border border-border dark:border-border/60 rounded-md outline-none focus:border-sidebar-accent focus:bg-background dark:focus:bg-background/50 transition-colors placeholder:text-muted-foreground/60 dark:placeholder:text-muted-foreground/80"
              />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-transparent">
              {isLoadingAgents && (
                <div className="px-2 py-1">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5">
                      <Skeleton className="h-[18px] w-[18px] rounded-[4px]" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  ))}
                </div>
              )}
              {agentsError && (
                <div className="px-2 py-1 text-xs text-red-500">
                  {agentsError}
                </div>
              )}
              {!isLoadingAgents &&
                filteredAgents &&
                filteredAgents.length === 0 && (
                  <div className="px-2 py-1 text-xs opacity-80">
                    No agents found
                  </div>
                )}
              {filteredAgents?.map((a, idx) => {
                // Show separator after last pinned agent
                const prevAgent = idx > 0 ? filteredAgents[idx - 1] : null;
                const showSeparator = prevAgent?.pinned && !a.pinned;
                const isHighlighted = idx === highlightedAgentIndex;

                return (
                  <>
                    {showSeparator && (
                      <DropdownMenuSeparator key={`sep-${a.id}`} />
                    )}
                    <DropdownMenuItem
                      key={a.id}
                      data-active={a.id === selectedAgentId}
                      data-highlighted={isHighlighted}
                      asChild
                    >
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) {
                            agentItemRefs.current.set(idx, el);
                          } else {
                            agentItemRefs.current.delete(idx);
                          }
                        }}
                        className={cn(
                          "gap-3 group/item flex flex-row justify-between items-center w-full py-2 cursor-pointer",
                          isHighlighted && "bg-accent"
                        )}
                        onClick={() => handleSelectAgent(a.id)}
                        onMouseEnter={() => setHighlightedAgentIndex(idx)}
                      >
                        <div className="flex flex-row gap-2 min-w-0 flex-1">
                          <div className="shrink-0">
                            <Avatar
                              seed={a.id}
                              src={a.avatar_url}
                              size={18}
                              className="rounded-[4px]"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5 items-start min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate">{a.name}</span>
                              {a.pinned && (
                                <Star className="h-3 w-3 fill-current text-yellow-500" />
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {idx < 9 && <Keycap>{idx + 1}</Keycap>}
                          <div className="text-foreground dark:text-foreground opacity-0 group-data-[active=true]/item:opacity-100">
                            <CheckCircleFillIcon size={12} />
                          </div>
                        </div>
                      </button>
                    </DropdownMenuItem>
                  </>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* {resolvedAgentId && (
        <AgentOptions
          id={resolvedAgentId}
          deployment={agentDeployment}
          messages={messages}
          onOptions={setOptions}
          onOptionSelected={() => messageInputRef.current?.focus()}
        />
      )} */}
    </>
  );

  // Don't show empty state while loading an existing chat
  const isLoadingExistingChat = shouldFetchHistory && isLoading;
  let renderedEmptyState: React.ReactNode | null = null;
  if (
    messages.length === 0 &&
    status !== "streaming" &&
    !isLoadingExistingChat
  ) {
    renderedEmptyState = emptyState;
    if (!renderedEmptyState) {
      renderedEmptyState = (
        <div className="flex flex-col items-center justify-center h-[300px] text-center px-8">
          <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mb-4">
            <MessageSquare className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">
            Start a conversation with your agent
          </p>
        </div>
      );
    }
  }

  const isActive =
    status === "submitted" || status === "streaming" || Boolean(id);

  return (
    <div className="flex flex-col min-h-0 h-full w-full min-w-0 flex-1 relative">
      <div
        ref={containerRef}
        className={cn(
          "flex flex-col-reverse gap-4 min-h-0 overflow-y-auto p-2 scrollbar-transparent scrollbar-gutter-stable-both-edges",
          isActive ? "flex-1" : "flex-none h-0"
        )}
      >
        {/* Bottom sentinel (latest) */}
        <div ref={endRef} className="shrink-0 min-h-px" />
        {(status === "streaming" || status === "submitted") && (
          <div className="mx-auto px-4 w-full md:max-w-3xl max-w-full">
            <div className="flex items-center gap-2">
              <LogoBlinkHopping size={52} animate={true} />
              <span className="italic opacity-70">Blinking...</span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-6">
          {messages.map((message, index) => (
            <PreviewMessage
              key={message.id}
              message={message}
              showTimestamp={false}
              canEditMessage={false}
              isStreaming={
                status === "streaming" && index === messages.length - 1
              }
              isLatestMessage={index === messages.length - 1}
              chatId={""}
              showDebug={Boolean(agent)}
            />
          ))}
        </div>
        {/* Top sentinel to load older pages */}
        <div ref={topRef} className="shrink-0 min-h-px" />
      </div>

      {(displayedMessagesError || displayedChatError || agentsError) && (
        <div className="mx-auto px-4 w-full md:max-w-3xl max-w-full pb-2 space-y-2">
          {displayedMessagesError && (
            <Alert variant="destructive" className="relative">
              <AlertTitle>Failed to load messages</AlertTitle>
              <AlertDescription>
                {displayedMessagesError.message}
              </AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-destructive/20"
                onClick={() => setDisplayedMessagesError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </Alert>
          )}
          {displayedChatError && (
            <Alert variant="destructive" className="relative">
              <AlertTitle>Chat error</AlertTitle>
              <AlertDescription>{displayedChatError.message}</AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-destructive/20"
                onClick={() => setDisplayedChatError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </Alert>
          )}
          {agentsError && (
            <Alert variant="destructive" className="relative">
              <AlertTitle>Failed to load agents</AlertTitle>
              <AlertDescription>{agentsError}</AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-destructive/20"
                onClick={() => setAgentsError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </Alert>
          )}
        </div>
      )}

      <div
        className={`${messages.length > 0 ? "sticky bottom-0" : "my-auto"} mx-auto px-4 w-full md:max-w-3xl max-w-full`}
      >
        {renderedEmptyState}
        <ChatMultimodalInput
          messageInputRef={messageInputRef}
          id={id}
          submit={(message, opts) => {
            if (!resolvedAgentId) return;
            // Clear errors when sending a new message
            setDisplayedChatError(null);
            setDisplayedMessagesError(null);

            // Build message parts - include text and file parts
            const parts: Array<
              | { type: "text"; text: string }
              | { type: "file"; url: string; mediaType: string }
            > = [];

            // Add file parts first
            for (const attachment of opts.attachments) {
              const url = `${window.location.origin}/api/files/${attachment.id}`;
              parts.push({
                type: "file" as const,
                url,
                mediaType: attachment.content_type,
              });
            }

            // Add text part if present
            if (message) {
              parts.push({ type: "text" as const, text: message });
            }

            sendMessage({
              role: "user",
              parts,
              metadata: {
                options,
              },
            });
          }}
          streaming={status === "streaming"}
          stop={stop}
          adornment={adornment}
          ghostText={ghostText}
          onAcceptGhostText={handleAcceptGhostText}
          onCancelGhostText={handleCancelGhostText}
          onInputChange={(value) => setInputText(value)}
        />
      </div>
    </div>
  );
}
