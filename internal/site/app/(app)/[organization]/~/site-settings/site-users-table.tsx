"use client";

import type { SiteUser } from "@blink.so/api";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SiteUsersTableProps {
  users: SiteUser[];
  isLoading?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  roleFilter: string;
  onRoleFilterChange: (role: string) => void;
  page?: number;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  hasMore?: boolean;
  onPreviousPage?: () => void;
  onNextPage?: () => void;
  onUpdateSuspension?: (userId: string, suspended: boolean) => Promise<void>;
  onChangeRole?: (user: SiteUser) => void;
  onCreateUser?: () => void;
}

const formatRole = (role: string): string => {
  switch (role) {
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
};

const formatDate = (date: string | Date): string => {
  return new Date(date).toLocaleDateString();
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function SiteUsersTable({
  users,
  isLoading,
  searchQuery,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  page = 1,
  pageSize = 25,
  onPageSizeChange,
  hasMore = false,
  onPreviousPage,
  onNextPage,
  onUpdateSuspension,
  onChangeRole,
  onCreateUser,
}: SiteUsersTableProps) {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [suspensionDialog, setSuspensionDialog] = useState<{
    open: boolean;
    user: SiteUser | null;
    action: "suspend" | "unsuspend";
  }>({ open: false, user: null, action: "suspend" });
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSuspensionAction = async () => {
    if (!suspensionDialog.user || !onUpdateSuspension) return;
    setIsUpdating(true);
    try {
      await onUpdateSuspension(
        suspensionDialog.user.id,
        suspensionDialog.action === "suspend"
      );
    } finally {
      setIsUpdating(false);
      setSuspensionDialog({ open: false, user: null, action: "suspend" });
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <section aria-labelledby="users-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-2 px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <Filter className="h-4 w-4" />
              <span>
                {roleFilter === "all" ? "All Roles" : formatRole(roleFilter)}
              </span>
            </button>

            {showFilterDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg z-10">
                {[
                  { value: "all", label: "All Roles" },
                  { value: "admin", label: "Admin" },
                  { value: "member", label: "Member" },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    onClick={() => {
                      onRoleFilterChange(option.value);
                      setShowFilterDropdown(false);
                    }}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 first:rounded-t-lg last:rounded-b-lg ${
                      roleFilter === option.value
                        ? "bg-neutral-50 dark:bg-neutral-800 font-medium"
                        : ""
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button onClick={onCreateUser}>
            <Plus className="h-4 w-4 mr-2" />
            Create user
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        {isLoading ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : users.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No users found
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b bg-neutral-50 dark:bg-neutral-900/50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    User
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Role
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Joined
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <Avatar
                        src={user.avatar_url}
                        seed={user.organization_id}
                        size={32}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {user.display_name || user.username || "Unknown User"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground cursor-help">
                            {formatRole(user.site_role)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="font-medium mb-1">
                            {user.site_role === "admin"
                              ? "Site Admin"
                              : "Member"}
                          </p>
                          <p className="text-xs">
                            {user.site_role === "admin"
                              ? "Has administrative access to the entire site"
                              : "Regular user with standard permissions"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    {user.suspended ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        Suspended
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap text-muted-foreground">
                    Joined {formatDate(user.created_at)}
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onChangeRole?.(user)}>
                          Change role
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setSuspensionDialog({
                              open: true,
                              user,
                              action: user.suspended ? "unsuspend" : "suspend",
                            })
                          }
                          className={
                            user.suspended
                              ? ""
                              : "text-red-500 focus:text-red-500"
                          }
                        >
                          {user.suspended ? "Unsuspend user" : "Suspend user"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 pb-8">
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">Page {page}</div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Rows per page:
            </span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
              disabled={isLoading}
              className="h-9 w-16 px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 text-sm leading-normal focus:outline-none focus:ring-2 focus:ring-neutral-500"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onPreviousPage}
            disabled={page <= 1 || isLoading}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onNextPage}
            disabled={!hasMore || isLoading}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={suspensionDialog.open}
        onOpenChange={(open) =>
          !open &&
          setSuspensionDialog({ open: false, user: null, action: "suspend" })
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {suspensionDialog.action === "suspend"
                ? "Suspend user"
                : "Unsuspend user"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {suspensionDialog.action === "suspend" ? (
                <>
                  Are you sure you want to suspend{" "}
                  <strong>
                    {suspensionDialog.user?.display_name ||
                      suspensionDialog.user?.username}
                  </strong>
                  ? They will no longer be able to access the platform.
                </>
              ) : (
                <>
                  Are you sure you want to unsuspend{" "}
                  <strong>
                    {suspensionDialog.user?.display_name ||
                      suspensionDialog.user?.username}
                  </strong>
                  ? They will regain access to the platform.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSuspensionAction}
              disabled={isUpdating}
              className={
                suspensionDialog.action === "suspend"
                  ? "bg-red-600 hover:bg-red-700 focus:ring-red-600 text-white"
                  : ""
              }
            >
              {isUpdating
                ? suspensionDialog.action === "suspend"
                  ? "Suspending..."
                  : "Unsuspending..."
                : suspensionDialog.action === "suspend"
                  ? "Suspend"
                  : "Unsuspend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
