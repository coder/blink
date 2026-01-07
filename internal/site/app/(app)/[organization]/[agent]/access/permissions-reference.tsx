"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Check, HelpCircle, X } from "lucide-react";

const PERMISSION_FEATURES = [
  {
    category: "Using the agent",
    features: [
      { name: "Create and use chats", read: true, write: true, admin: true },
      { name: "View own chat history", read: true, write: true, admin: true },
      { name: "View all chats", read: false, write: true, admin: true },
    ],
  },
  {
    category: "Development & debugging",
    features: [
      {
        name: "View source code",
        read: true,
        write: true,
        admin: true,
      },
      {
        name: "Create deployments",
        read: false,
        write: true,
        admin: true,
      },
      { name: "View logs & traces", read: false, write: true, admin: true },
      {
        name: "Manage environment variables",
        read: false,
        write: true,
        admin: true,
      },
      { name: "View usage analytics", read: true, write: true, admin: true },
    ],
  },
  {
    category: "Management",
    features: [
      {
        name: "Change agent settings",
        read: false,
        write: false,
        admin: true,
      },
      {
        name: "Manage member access",
        read: false,
        write: false,
        admin: true,
      },
      { name: "Delete agent", read: false, write: false, admin: true },
    ],
  },
];

function PermissionIcon({ allowed }: { allowed: boolean }) {
  if (allowed) {
    return (
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30">
        <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-800">
      <X className="w-4 h-4 text-neutral-400 dark:text-neutral-600" />
    </div>
  );
}

export function PermissionsReferenceModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <HelpCircle className="h-4 w-4" />
          <span>What can each role do?</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Permission levels</DialogTitle>
          <DialogDescription>
            Understand what each permission level allows
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>Note:</strong> Organization admins and owners
              automatically have admin permission on all agents in this
              organization.
            </p>
          </div>
          <div className="space-y-6">
            {/* Permission headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 pb-3 border-b">
              <div className="text-sm font-medium text-muted-foreground">
                Feature
              </div>
              <div className="text-sm font-medium text-center w-24">Read</div>
              <div className="text-sm font-medium text-center w-24">Write</div>
              <div className="text-sm font-medium text-center w-24">Admin</div>
            </div>

            {/* Permission categories */}
            {PERMISSION_FEATURES.map((category, categoryIndex) => (
              <div key={categoryIndex} className="space-y-3">
                <h4 className="text-sm font-medium text-foreground">
                  {category.category}
                </h4>
                <div className="space-y-2">
                  {category.features.map((feature, featureIndex) => (
                    <div
                      key={featureIndex}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center py-2"
                    >
                      <div className="text-sm text-muted-foreground">
                        {feature.name}
                      </div>
                      <div className="flex justify-center w-24">
                        <PermissionIcon allowed={feature.read} />
                      </div>
                      <div className="flex justify-center w-24">
                        <PermissionIcon allowed={feature.write} />
                      </div>
                      <div className="flex justify-center w-24">
                        <PermissionIcon allowed={feature.admin} />
                      </div>
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
                    R
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium">Read</p>
                  <p className="text-xs text-muted-foreground">
                    Perfect for team members who need to use the agent
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                    W
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium">Write</p>
                  <p className="text-xs text-muted-foreground">
                    For developers who build and debug agents
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium text-orange-600 dark:text-orange-400">
                    A
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium">Admin</p>
                  <p className="text-xs text-muted-foreground">
                    Full control for managing the agent and its access
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
