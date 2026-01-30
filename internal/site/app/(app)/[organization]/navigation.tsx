"use client";

import { LayoutDashboard, Settings, Shield, Users } from "lucide-react";
import { Navigation, type NavigationItem } from "@/components/ui/navigation";

export function OrganizationNavigation({
  name,
  isPersonal,
  isSiteAdmin,
}: {
  name: string;
  isPersonal: boolean;
  isSiteAdmin?: boolean;
}) {
  const base = `/${name}`;

  const items: NavigationItem[] = [
    {
      value: "overview",
      label: "Overview",
      href: `${base}`,
      icon: LayoutDashboard,
    },
    // { value: "agents", label: "Agents", href: `${base}/agents`, icon: Bot },
    ...(!isPersonal
      ? [
          {
            value: "people",
            label: "People",
            href: `${base}/~/people`,
            icon: Users,
          } as NavigationItem,
        ]
      : []),
    {
      value: "settings",
      label: "Settings",
      href: `${base}/~/settings`,
      icon: Settings,
    },
    ...(isPersonal && isSiteAdmin
      ? [
          {
            value: "site-settings",
            label: "Site Settings",
            href: `${base}/~/site-settings/users`,
            icon: Shield,
          } as NavigationItem,
        ]
      : []),
  ];

  return <Navigation items={items} sticky />;
}
