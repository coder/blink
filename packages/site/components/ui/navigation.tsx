"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tab-nav";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavigationItem = {
  value: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  disabled?: boolean;
  tooltip?: string;
};

type NavigationProps = {
  items: NavigationItem[];
  className?: string;
  containerClassName?: string;
  tabsClassName?: string;
  listClassName?: string;
  triggerClassName?: string;
  activeValue?: string;
  sticky?: boolean;
  showIcons?: boolean;
};

export function Navigation({
  items,
  className,
  containerClassName,
  tabsClassName,
  listClassName,
  triggerClassName,
  activeValue,
  sticky = false,
  showIcons = true,
}: NavigationProps) {
  const pathname = usePathname();

  const active =
    activeValue ??
    (() => {
      if (!pathname) return items[0]?.value ?? "";

      const overviewItem = items.find((i) => i.value === "overview");
      if (overviewItem) {
        if (
          pathname === overviewItem.href ||
          pathname === `${overviewItem.href}/`
        ) {
          return "overview";
        }
      }

      for (const item of items) {
        if (item.value !== "overview" && pathname.startsWith(item.href)) {
          return item.value;
        }
      }

      return overviewItem?.value ?? items[0]?.value ?? "";
    })();

  const renderTabTrigger = (item: NavigationItem) => {
    const triggerContent = (
      <>
        {showIcons && item.icon ? (
          <span className="inline-flex items-center gap-2">
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </span>
        ) : (
          item.label
        )}
      </>
    );

    const trigger = (
      <TabsTrigger
        value={item.value}
        disabled={item.disabled && !item.tooltip}
        className={cn(
          "rounded-none bg-transparent hover:bg-transparent data-[state=active]:bg-transparent border-b-2 border-transparent data-[state=active]:border-primary text-muted-foreground data-[state=active]:text-foreground hover:text-foreground px-3 py-3",
          item.disabled && "opacity-50 cursor-not-allowed",
          triggerClassName
        )}
      >
        {triggerContent}
      </TabsTrigger>
    );

    if (item.tooltip) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <div>{trigger}</div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{item.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return trigger;
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          sticky
            ? "sticky top-0 z-10 w-full border-b dark:bg-black bg-white backdrop-blur supports-backdrop-filter:bg-background/60"
            : undefined,
          className
        )}
      >
        <div className={cn("mx-auto px-4", containerClassName)}>
          <Tabs value={active} className={cn("w-full", tabsClassName)}>
            <TabsList className={cn("h-12 px-0 gap-2", listClassName)}>
              {items.map((item) =>
                item.disabled ? (
                  <span
                    key={item.value}
                    className="inline-flex cursor-not-allowed"
                  >
                    {renderTabTrigger(item)}
                  </span>
                ) : (
                  <Link key={item.value} href={item.href}>
                    {renderTabTrigger(item)}
                  </Link>
                )
              )}
            </TabsList>
          </Tabs>
        </div>
      </div>
    </TooltipProvider>
  );
}
