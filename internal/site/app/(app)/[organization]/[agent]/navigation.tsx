"use client";

import { Navigation, type NavigationItem } from "@/components/ui/navigation";
import type { Agent, Organization } from "@blink.so/api";
import {
  Activity,
  BarChart2,
  Code,
  LayoutDashboard,
  Logs,
  MessageSquare,
  Server,
  Settings,
  Users,
} from "lucide-react";

export function AgentNavigation({
  organization,
  agent,
  isPersonalOrg,
}: {
  organization: Organization;
  agent: Agent;
  isPersonalOrg: boolean;
}) {
  const base = `/${organization.name}/${agent.name}`;
  const permission = agent.user_permission ?? "read";
  const isAdmin = permission === "admin";
  const isWrite = permission === "write" || permission === "admin";

  const items: NavigationItem[] = [
    {
      value: "overview",
      label: "Overview",
      href: `${base}`,
      icon: LayoutDashboard,
    },
    {
      value: "deployments",
      label: "Deployments",
      href: `${base}/deployments`,
      icon: Server,
    },
    {
      value: "chats",
      label: "Chats",
      href: `${base}/chats`,
      icon: MessageSquare,
    },
    {
      value: "source",
      label: "Source",
      href: `${base}/source`,
      icon: Code,
    },
    // Only show logs and traces to write/admin users
    ...(isWrite
      ? [
          {
            value: "logs" as const,
            label: "Logs",
            href: `${base}/logs`,
            icon: Logs,
          },
          {
            value: "traces" as const,
            label: "Traces",
            href: `${base}/traces`,
            icon: Activity,
          },
        ]
      : []),
    {
      value: "usage",
      label: "Usage",
      href: `${base}/usage`,
      icon: BarChart2,
    },
    // Only show access to admins in non-personal organizations
    ...(isAdmin && !isPersonalOrg
      ? [
          {
            value: "access" as const,
            label: "Access",
            href: `${base}/access`,
            icon: Users,
          },
        ]
      : []),
    // Only show settings to admins
    ...(isAdmin
      ? [
          {
            value: "settings" as const,
            label: "Settings",
            href: `${base}/settings`,
            icon: Settings,
          },
        ]
      : []),
  ];

  return <Navigation items={items} sticky />;
}
