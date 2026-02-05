"use client";

import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import type { Agent, Organization, User } from "@blink.so/api";
import Link from "next/link";
import { LogoBlink } from "./icons";
import AgentSelector from "./organization-agent-selector";
import { toast } from "./toast";
import Avatar from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export default function Header({
  user,
  organization,
  agent,
  enableMultiOrg = true,
}: {
  user?: User;
  organization?: Organization;
  agent?: Agent;
  enableMultiOrg?: boolean;
}) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    setTheme("dark");
  }, []);

  return (
    <header
      className={cn([
        "flex top-0 py-1.5 items-center px-2 pr-0 md:px-2 md:pr-2 gap-2 h-[var(--header-height)]",
        "z-10 transition-colors duration-300 sticky bg-sidebar text-secondary-foreground",
      ])}
    >
      <div className="flex items-center flex-1">
        <Link href="/chat">
          <LogoBlink className="pl-2" hideText />
        </Link>

        <Divider />

        <div className="flex flex-row items-center">
          {!organization && !agent && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <NavItemContent>
                  Agents
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </NavItemContent>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="p-0">
                <AgentSelector
                  selectedOrganization={organization}
                  enableMultiOrg={enableMultiOrg}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {organization && (
            <div className="flex items-center gap-2">
              <Link
                href={`/${organization.name}`}
                className="flex items-center gap-2"
              >
                <Avatar
                  seed={organization.id}
                  src={organization.avatar_url}
                  size={24}
                  className="rounded-md border border-border"
                />
                <span className="text-sm font-medium">{organization.name}</span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open organization switcher"
                    className="rounded-sm p-1 hover:bg-accent/50"
                  >
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-0">
                  <AgentSelector
                    selectedOrganization={organization}
                    enableMultiOrg={enableMultiOrg}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {agent && organization && <Divider />}

          {agent && organization && (
            <div className="flex items-center gap-1">
              <Link
                href={`/${organization.name}/${agent.name}`}
                className="flex items-center gap-2"
              >
                <Avatar
                  seed={agent.id}
                  src={agent.avatar_url}
                  size={24}
                  className="rounded-sm"
                />
                <span className="text-sm font-medium">{agent.name}</span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open agent switcher"
                    className="rounded-sm p-1 hover:bg-accent/50"
                  >
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-0">
                  <AgentSelector
                    selectedOrganization={organization}
                    selectedAgent={agent}
                    enableMultiOrg={enableMultiOrg}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      <div className={cn(["ml-auto flex items-center gap-2"])}>
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="user-nav-button"
                variant="ghost"
                className="h-9 px-3 gap-2 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none"
              >
                <Avatar
                  src={user?.avatar_url}
                  seed={user?.organization_id ?? "user"}
                  size={24}
                  rounded="lg"
                  alt={user?.email ?? "User Avatar"}
                />
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-testid="user-nav-menu"
              side="bottom"
              align="end"
              className="w-56"
            >
              <DropdownMenuItem
                className="text-sm text-muted-foreground cursor-default focus:bg-transparent focus:text-muted-foreground"
                onSelect={(e) => e.preventDefault()}
              >
                Signed in: {user?.email ?? "No email provided"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/user" className="cursor-pointer">
                  User Settings
                </a>
              </DropdownMenuItem>
              {user.site_role === "admin" && (
                <DropdownMenuItem asChild>
                  <a
                    href={`/${user.username}/~/site-settings/users`}
                    className="cursor-pointer"
                  >
                    Site Settings
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a
                  href="https://docs.blink.so"
                  className="cursor-pointer"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Documentation
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild data-testid="user-nav-item-auth">
                <button
                  type="button"
                  className="w-full cursor-pointer"
                  onClick={() => {
                    if (status === "loading") {
                      toast({
                        type: "error",
                        description:
                          "Checking authentication status, please try again!",
                      });

                      return;
                    }

                    signOut({
                      redirectTo: "/",
                    });
                  }}
                >
                  {"Sign out"}
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

const Divider = () => {
  return (
    <div className="text-muted-foreground opacity-25 text-xl ml-4 mr-4">/</div>
  );
};

const NavItemContent = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
      {children}
    </div>
  );
};
