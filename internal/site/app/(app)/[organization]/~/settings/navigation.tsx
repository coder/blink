"use client";

import {
  SettingsNavigation,
  type SettingsTab,
} from "@/components/settings-navigation";
import { useSession } from "next-auth/react";

export function OrganizationSettingsNav({
  organizationName,
  isPersonalOrg,
}: {
  organizationName: string;
  isPersonalOrg: boolean;
}) {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  // In development, show admin tab for all users. In production, only for whitelisted admins.
  const isDevelopment = process.env.NODE_ENV === "development";
  const isAdmin =
    userId === "4e33e42e-8569-40d9-ae4b-7cfdf1dcee0d" ||
    userId === "c8bed466-cefa-4c34-832c-053ca436dd20" ||
    userId === "dafbeb61-aa17-4feb-8988-a11344813112" ||
    userId === "2f71f39f-45f0-43cc-b7c6-becf12da0795";
  const showAdminTab = isPersonalOrg && (isDevelopment || isAdmin);

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
    ...(showAdminTab
      ? [
          {
            value: "site-admin",
            label: "Site Admin",
            href: `/${organizationName}/~/site-admin`,
          },
        ]
      : []),
  ];

  const getActiveTab = (pathname: string | null) => {
    if (pathname?.includes("/site-admin")) return "site-admin";
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
