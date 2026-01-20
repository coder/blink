"use client";

import { Navigation, type NavigationItem } from "@/components/ui/navigation";
import { LayoutDashboard, Settings, Users } from "lucide-react";

export function OrganizationNavigation({
  name,
  isPersonal,
}: {
  name: string;
  isPersonal: boolean;
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
  ];

  return <Navigation items={items} sticky />;
}
