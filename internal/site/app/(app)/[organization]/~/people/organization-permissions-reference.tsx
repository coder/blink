"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, X } from "lucide-react";

interface PermissionFeature {
  name: string;
  member: boolean | string;
  admin: boolean | string;
  owner: boolean | string;
  detail?: string;
}

interface PermissionCategory {
  category: string;
  features: PermissionFeature[];
}

const ORG_PERMISSION_FEATURES: PermissionCategory[] = [
  {
    category: "Using Agents",
    features: [
      {
        name: "View all agents",
        member: true,
        admin: true,
        owner: true,
      },
      {
        name: "Create agents",
        member: true,
        admin: true,
        owner: true,
      },
      {
        name: "Chat with agents",
        member: true,
        admin: true,
        owner: true,
      },
    ],
  },
  {
    category: "Agent Access Levels",
    features: [
      {
        name: "Created agents",
        member: "Admin",
        admin: "Admin",
        owner: "Admin",
        detail: "Full control over agents you create",
      },
      {
        name: "All other agents",
        member: "As granted",
        admin: "Admin",
        owner: "Admin",
        detail: "Admins/Owners get admin on ALL agents",
      },
      {
        name: "Grant agent access",
        member: false,
        admin: true,
        owner: true,
      },
    ],
  },
  {
    category: "Organization Management",
    features: [
      {
        name: "Invite members",
        member: false,
        admin: true,
        owner: true,
      },
      {
        name: "Change member roles",
        member: false,
        admin: true,
        owner: true,
      },
      {
        name: "Remove members",
        member: false,
        admin: true,
        owner: true,
      },
    ],
  },
  {
    category: "Organization Settings",
    features: [
      {
        name: "Change org name",
        member: false,
        admin: false,
        owner: true,
      },
      {
        name: "Delete organization",
        member: false,
        admin: false,
        owner: true,
      },
      {
        name: "Manage billing",
        member: false,
        admin: false,
        owner: true,
      },
    ],
  },
];

function PermissionCell({ value }: { value: boolean | string }) {
  if (typeof value === "string") {
    return (
      <div className="flex justify-center w-28">
        <span className="text-xs font-medium px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
          {value}
        </span>
      </div>
    );
  }

  if (value) {
    return (
      <div className="flex justify-center w-28">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30">
          <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center w-28">
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-800">
        <X className="w-4 h-4 text-neutral-400 dark:text-neutral-600" />
      </div>
    </div>
  );
}

export function OrganizationPermissionsReference() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Organization roles</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Understand what each role can do in this organization
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Permission headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 pb-3 border-b">
            <div className="text-sm font-medium text-muted-foreground">
              Permission
            </div>
            <div className="text-sm font-medium text-center w-28">Member</div>
            <div className="text-sm font-medium text-center w-28">Admin</div>
            <div className="text-sm font-medium text-center w-28">Owner</div>
          </div>

          {/* Permission categories */}
          {ORG_PERMISSION_FEATURES.map((category, categoryIndex) => (
            <div key={categoryIndex} className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">
                {category.category}
              </h4>
              <div className="space-y-2">
                {category.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="space-y-1">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center py-2">
                      <div className="text-sm text-muted-foreground">
                        {feature.name}
                      </div>
                      <PermissionCell value={feature.member} />
                      <PermissionCell value={feature.admin} />
                      <PermissionCell value={feature.owner} />
                    </div>
                    {feature.detail && (
                      <div className="text-xs text-muted-foreground pl-0">
                        {feature.detail}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Summary section */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex-shrink-0 mt-0.5">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  M
                </span>
              </div>
              <div>
                <p className="text-sm font-medium">Member</p>
                <p className="text-xs text-muted-foreground">
                  Can create agents and use them, admin on agents they create
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex-shrink-0 mt-0.5">
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                  A
                </span>
              </div>
              <div>
                <p className="text-sm font-medium">Admin</p>
                <p className="text-xs text-muted-foreground">
                  Admin access to ALL agents plus member management
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex-shrink-0 mt-0.5">
                <span className="text-xs font-medium text-orange-600 dark:text-orange-400">
                  O
                </span>
              </div>
              <div>
                <p className="text-sm font-medium">Owner</p>
                <p className="text-xs text-muted-foreground">
                  Complete control including organization settings
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
