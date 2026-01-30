"use client";

import {
  SettingsNavigation,
  type SettingsTab,
} from "@/components/settings-navigation";

export function SiteAdminNav({
  organizationName,
}: {
  organizationName: string;
}) {
  const tabs: SettingsTab[] = [
    {
      value: "users",
      label: "Users",
      href: `/${organizationName}/~/site-settings/users`,
    },
  ];

  const getActiveTab = (pathname: string | null) => {
    if (pathname?.includes("/users")) return "users";
    return "users";
  };

  return (
    <SettingsNavigation
      title="Site Settings"
      tabs={tabs}
      getActiveTab={getActiveTab}
    />
  );
}
