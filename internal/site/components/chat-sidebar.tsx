"use client";

import { ChatHistory } from "@/components/chat-history";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { User } from "@blink.so/api";
import { SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Keycap from "./ui/keycap";
import { Separator } from "./ui/separator";

export default function ChatSidebar({
  user,
  agentID,
  hrefBase,
}: {
  user: User;
  agentID?: string;
  hrefBase: string;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem("appSidebar:collapsed")
        : null;
    if (saved === "1") setIsCollapsed(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "appSidebar:collapsed",
      isCollapsed ? "1" : "0"
    );
  }, [isCollapsed]);

  const widthClass = !isMobile && isCollapsed ? "w-[72px]" : "w-[280px]";

  return (
    <div
      className={cn(
        "relative flex flex-col min-h-0 bg-sidebar scrollbar-transparent overflow-hidden transition-none",
        widthClass
      )}
    >
      <div
        className={cn(
          "gap-2 pb-2 flex flex-col pt-2",
          isCollapsed ? "px-1 items-center" : "px-2"
        )}
      >
        <Link href={hrefBase} prefetch={true}>
          <Button
            variant="ghost"
            size={isCollapsed ? "icon" : "sm"}
            type="button"
            className={cn(
              "group",
              isCollapsed ? "w-9 h-9" : "w-full justify-start gap-2 pl-2"
            )}
            title="New Chat"
            onClick={() => {
              setOpenMobile(false);
            }}
          >
            <SquarePen size={16} />
            {!isCollapsed && <span className="flex-1 text-left">New Chat</span>}
            {!isCollapsed && !isMobile && (
              <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <Keycap>Ctrl</Keycap>+<Keycap>Shift</Keycap>+<Keycap>O</Keycap>
              </span>
            )}
          </Button>
        </Link>
      </div>

      <Separator />

      <div className="flex flex-col min-h-0 flex-1">
        <div className="flex flex-1 overflow-y-auto flex-col">
          <ChatHistory user={user} hrefBase={hrefBase} agentID={agentID} />
        </div>
      </div>
    </div>
  );
}
