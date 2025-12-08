"use client";

import { LoaderIcon, MoreHorizontalIcon, TrashIcon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, slugToUuid, titleToSlug, uuidToSlug } from "@/lib/utils";
import type { Chat, ListChatsResponse, User } from "@blink.so/api";
import Client from "@blink.so/api";
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import Avatar from "./ui/avatar";

const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 2000;

function getDate(d: string) {
  return new Date(d);
}

const sortByUpdatedDesc = (a: Chat, b: Chat) =>
  getDate(b.updated_at).getTime() - getDate(a.updated_at).getTime();

export type Grouped = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

function groupByDate(chats: Chat[]): Grouped {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  const groups: Grouped = {
    today: [],
    yesterday: [],
    lastWeek: [],
    lastMonth: [],
    older: [],
  };

  for (const chat of chats) {
    const d = getDate(chat.updated_at);
    if (isToday(d)) groups.today.push(chat);
    else if (isYesterday(d)) groups.yesterday.push(chat);
    else if (d > oneWeekAgo) groups.lastWeek.push(chat);
    else if (d > oneMonthAgo) groups.lastMonth.push(chat);
    else groups.older.push(chat);
  }

  groups.today.sort(sortByUpdatedDesc);
  groups.yesterday.sort(sortByUpdatedDesc);
  groups.lastWeek.sort(sortByUpdatedDesc);
  groups.lastMonth.sort(sortByUpdatedDesc);
  groups.older.sort(sortByUpdatedDesc);

  return groups;
}

function useCurrentChatID() {
  const params = useParams();
  const pathname = usePathname();
  return useMemo(() => {
    if (!pathname.startsWith("/chat/")) return null;
    if (!params.id || (Array.isArray(params.id) && params.id.length === 0))
      return null;
    const first = Array.isArray(params.id)
      ? params.id[0]
      : (params.id as unknown as string);
    return slugToUuid(first);
  }, [params, pathname]);
}

function useChatsInfinite(organizationId: string, agentID?: string) {
  const client = useMemo(() => new Client(), []);

  return useSWRInfinite(
    (index: number, previousPage: ListChatsResponse | null) => {
      if (index === 0) {
        return ["chats", organizationId, agentID, null];
      }
      if (!previousPage || previousPage.next_cursor == null) {
        return null;
      }
      return ["chats", organizationId, agentID, previousPage.next_cursor];
    },
    async ([_label, orgId, agentID, cursor]) => {
      return client.chats.list({
        organization_id: agentID ? undefined : orgId,
        cursor: cursor ?? undefined,
        limit: PAGE_SIZE,
        agent_id: agentID!,
      });
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      persistSize: true,
      revalidateFirstPage: false,
    }
  );
}

function StatusDot({
  status,
  isActive,
  className,
}: {
  status: Chat["status"];
  isActive: boolean;
  className?: string;
}) {
  if (status === "error") {
    return (
      <div
        className={cn("w-2 h-2 rounded-full bg-red-500 shrink-0", className)}
      />
    );
  }
  if (status === "streaming") {
    return (
      <div
        className={cn(
          "w-2 h-2 rounded-full bg-blue-500 shrink-0 animate-pulse",
          className
        )}
      />
    );
  }
  if (status === "interrupted" && !isActive) {
    return (
      <div
        className={cn("w-2 h-2 rounded-full bg-yellow-500 shrink-0", className)}
      />
    );
  }
  return null;
}

function ChatRow({
  chat,
  isActive,
  onDelete,
  onClick,
  hrefBase,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (id: string) => void;
  onClick: () => void;
  hrefBase: string;
}) {
  return (
    <SidebarMenuItem className="group/item mb-1">
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <SidebarMenuButton asChild isActive={isActive} size={"lg"}>
              <Link
                href={`${hrefBase}/${titleToSlug(chat.title)}-${uuidToSlug(chat.id)}`}
                onClick={onClick}
              >
                <div className="flex gap-2 w-full min-w-0 py-2">
                  <StatusDot
                    status={chat.status}
                    isActive={isActive}
                    className="mt-1"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{chat.title || "Untitled"}</span>
                    <span className="truncate text-xs text-sidebar-foreground/60">
                      {chat.agent.name}
                    </span>
                  </div>
                </div>
              </Link>
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-[320px]">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium leading-tight break-words">
                {chat.title || "Untitled"}
              </div>
              <div className="flex items-center gap-2">
                <Avatar
                  seed={chat.agent.id}
                  src={chat.agent.avatar_url}
                  size={20}
                  className="rounded-[4px] shrink-0"
                />
                <div className="text-sm">{chat.agent.name}</div>
              </div>
              {chat.agent.description ? (
                <div className="text-xs opacity-80 whitespace-pre-wrap break-words">
                  {chat.agent.description}
                </div>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground mr-0.5 px-1"
            showOnHover={true}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
            onSelect={() => onDelete(chat.id)}
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function ChatHistory({
  user,
  agentID,
  hrefBase,
}: {
  user: User;
  agentID?: string;
  hrefBase: string;
}) {
  const { setOpenMobile } = useSidebar();
  const router = useRouter();
  const currentChatID = useCurrentChatID();

  const { data, setSize, isValidating, isLoading, mutate } = useChatsInfinite(
    user.organization_id,
    agentID
  );

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const items = useMemo(
    () => (data ? data.flatMap((p) => p.items) : []),
    [data]
  );

  const grouped = useMemo(() => groupByDate(items), [items]);

  const pollingRef = useRef(false);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const client = new Client();

    const poll = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const existingIds = new Set(items.map((c) => c.id));
        const pagesFetched: ListChatsResponse[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 5; i++) {
          const page = await client.chats.list({
            organization_id: agentID ? undefined : user.organization_id,
            cursor: cursor ?? undefined,
            limit: PAGE_SIZE,
            agent_id: agentID!,
          });
          pagesFetched.push(page);
          const hasOverlap = page.items.some((it) => existingIds.has(it.id));
          if (hasOverlap || page.next_cursor == null) {
            break;
          }
          cursor = page.next_cursor;
        }
        if (cancelled || pagesFetched.length === 0) return;
        mutate(
          (oldPages) => {
            if (!oldPages) return oldPages;
            const updated = [...oldPages];
            for (let i = 0; i < pagesFetched.length; i++) {
              updated[i] = pagesFetched[i];
            }
            return updated;
          },
          { revalidate: false }
        );
      } finally {
        pollingRef.current = false;
      }
    };

    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [data, items, user.organization_id, agentID, mutate]);

  const hasReachedEnd = data
    ? data.length > 0 && data[data.length - 1]?.next_cursor == null
    : false;
  const hasEmpty = data ? data.every((p) => p.items.length === 0) : false;

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;

    const client = new Client();
    const deletePromise = client.chats.delete(deleteId);

    toast.promise(deletePromise, {
      loading: "Deleting chat...",
      success: () => {
        mutate(
          (pages) => {
            if (!pages) return pages;
            return pages.map((p) => ({
              ...p,
              items: p.items.filter((c) => c.id !== deleteId),
            }));
          },
          { revalidate: false }
        );
        return "Chat deleted successfully";
      },
      error: "Failed to delete chat",
    });

    setShowDeleteDialog(false);

    if (deleteId === currentChatID) {
      router.push("/");
    }
  }, [deleteId, mutate, currentChatID, router]);

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-zinc-500 dark:text-zinc-400 w-full flex flex-row justify-center items-center text-sm gap-2">
            Login to save and revisit previous chats!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup>
        <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
          Today
        </div>
        <SidebarGroupContent>
          <div className="flex flex-col">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                key={item}
                className="rounded-md h-8 flex gap-2 px-4 items-center"
              >
                <div
                  className="h-4 rounded-md flex-1 max-w-(--skeleton-width) bg-sidebar-accent-foreground/10"
                  style={
                    { "--skeleton-width": `${item}%` } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmpty) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-zinc-500 dark:text-zinc-400 w-full flex flex-row justify-center items-center text-sm gap-2">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu className="relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-12 after:bg-linear-to-l after:from-[var(--sidebar-background)] after:via-[var(--sidebar-background)/0.7] after:to-transparent after:pointer-events-none after:z-10">
            {data && (
              <div className="flex flex-col gap-6">
                {grouped.today.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
                      Today
                    </div>
                    {grouped.today.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        hrefBase={hrefBase}
                        chat={chat}
                        isActive={chat.id === currentChatID}
                        onDelete={(id) => {
                          setDeleteId(id);
                          setShowDeleteDialog(true);
                        }}
                        onClick={() => setOpenMobile(false)}
                      />
                    ))}
                  </div>
                )}

                {grouped.yesterday.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
                      Yesterday
                    </div>
                    {grouped.yesterday.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        hrefBase={hrefBase}
                        chat={chat}
                        isActive={chat.id === currentChatID}
                        onDelete={(id) => {
                          setDeleteId(id);
                          setShowDeleteDialog(true);
                        }}
                        onClick={() => setOpenMobile(false)}
                      />
                    ))}
                  </div>
                )}

                {grouped.lastWeek.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
                      Last Week
                    </div>
                    {grouped.lastWeek.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        hrefBase={hrefBase}
                        chat={chat}
                        isActive={chat.id === currentChatID}
                        onDelete={(id) => {
                          setDeleteId(id);
                          setShowDeleteDialog(true);
                        }}
                        onClick={() => setOpenMobile(false)}
                      />
                    ))}
                  </div>
                )}

                {grouped.lastMonth.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
                      Last Month
                    </div>
                    {grouped.lastMonth.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        hrefBase={hrefBase}
                        chat={chat}
                        isActive={chat.id === currentChatID}
                        onDelete={(id) => {
                          setDeleteId(id);
                          setShowDeleteDialog(true);
                        }}
                        onClick={() => setOpenMobile(false)}
                      />
                    ))}
                  </div>
                )}

                {grouped.older.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
                      Older
                    </div>
                    {grouped.older.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        hrefBase={hrefBase}
                        chat={chat}
                        isActive={chat.id === currentChatID}
                        onDelete={(id) => {
                          setDeleteId(id);
                          setShowDeleteDialog(true);
                        }}
                        onClick={() => setOpenMobile(false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </SidebarMenu>

          {data && !hasReachedEnd ? (
            <motion.div
              onViewportEnter={() => {
                if (!isValidating && !hasReachedEnd) {
                  setSize((s) => s + 1);
                }
              }}
            />
          ) : null}

          {hasReachedEnd ? (
            <div className="px-2 text-zinc-500 dark:text-zinc-400 w-full flex flex-row justify-center items-center text-sm gap-2 mt-8">
              {items.length > 10
                ? "You have reached the end of your chat history."
                : null}
            </div>
          ) : (
            <div className="p-2 text-zinc-500 dark:text-zinc-400 flex flex-row gap-2 items-center mt-8">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div>Loading Chats...</div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              chat and remove all of its data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
