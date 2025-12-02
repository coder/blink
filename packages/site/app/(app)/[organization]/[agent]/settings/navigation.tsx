"use client";

import {
  SettingsNavigation,
  type SettingsTab,
} from "@/components/settings-navigation";
import { useParams } from "next/navigation";

export function AgentSettingsNav() {
  const params = useParams<{ organization: string; agent: string }>();
  const baseHref = `/${params.organization}/${params.agent}/settings`;

  const tabs: SettingsTab[] = [
    { value: "general", label: "General", href: baseHref },
    {
      value: "environment",
      label: "Environment Variables",
      href: `${baseHref}/env`,
    },
    { value: "webhooks", label: "Webhooks", href: `${baseHref}/webhooks` },
  ];

  const getActiveTab = (pathname: string | null) => {
    if (pathname?.includes("/settings/env")) return "environment";
    if (pathname?.includes("/settings/webhooks")) return "webhooks";
    return "general";
  };

  return (
    <SettingsNavigation
      title="Settings"
      tabs={tabs}
      getActiveTab={getActiveTab}
    />
  );
}
