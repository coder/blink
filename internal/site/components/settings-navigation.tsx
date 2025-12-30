"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tab-nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";

export type SettingsTab = {
  value: string;
  label: string;
  href: string;
};

type SettingsNavigationProps = {
  title: string;
  tabs: SettingsTab[];
  getActiveTab: (pathname: string | null) => string;
};

export function SettingsNavigation({
  title,
  tabs,
  getActiveTab,
}: SettingsNavigationProps) {
  const pathname = usePathname();

  const activeTab = useCallback(() => {
    return getActiveTab(pathname);
  }, [pathname, getActiveTab]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-medium">{title}</h1>
      </div>

      <Tabs value={activeTab()} className="w-full">
        <TabsList>
          {tabs.map((tab) => (
            <Link key={tab.value} href={tab.href}>
              <TabsTrigger value={tab.value}>{tab.label}</TabsTrigger>
            </Link>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
