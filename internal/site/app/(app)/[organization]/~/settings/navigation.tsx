"use client";

import {
  SettingsNavigation,
  type SettingsTab,
} from "@/components/settings-navigation";

export function OrganizationSettingsNav({
  organizationName,
  isPersonalOrg,
}: {
  organizationName: string;
  isPersonalOrg: boolean;
}) {
  const tabs: SettingsTab[] = [
    {
      value: "general",
      label: "General",
      href: `/${organizationName}/~/settings`,
    },
    ...(isPersonalOrg
      ? [
          {
            value: "api-keys",
            label: "API keys",
            href: `/${organizationName}/~/settings/api-keys`,
          },
        ]
      : []),
  ];

  const getActiveTab = (pathname: string | null) => {
    if (pathname?.includes("/api-keys")) return "api-keys";
    return "general";
  };

  return (
    <SettingsNavigation
      title={isPersonalOrg ? "User Settings" : "Organization Settings"}
      tabs={tabs}
      getActiveTab={getActiveTab}
    />
  );
}
