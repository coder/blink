"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Agent, Organization } from "@blink.so/api";
import Client from "@blink.so/api";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentPinned from "./agent-pinned";
import CreateOrganizationModal from "./create-organization-modal";
import Avatar from "./ui/avatar";

type AgentSelectorValue = {
  organization?: Organization | null;
  agent?: Agent | null;
};

export interface AgentSelectorProps {
  className?: string;
  selectedOrganization?: Organization | null;
  selectedAgent?: Agent | null;
}

export default function AgentSelector({
  className,
  selectedOrganization,
  selectedAgent,
}: AgentSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const client = useMemo(() => new Client(), []);

  const [organizations, setOrganizations] = useState<Organization[] | null>(
    null
  );
  const [orgError, setOrgError] = useState<string | null>(null);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [hoverOrgId, setHoverOrgId] = useState<string | null>(null);
  const hoverOrgTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [hoverAgentId, setHoverAgentId] = useState<string | null>(null);
  const hoverAgentTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [orgSearchQuery, setOrgSearchQuery] = useState("");
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const orgSearchInputRef = useRef<HTMLInputElement>(null);
  const agentSearchInputRef = useRef<HTMLInputElement>(null);

  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);

  // Load organizations on mount
  useEffect(() => {
    if (organizations) return;
    let cancelled = false;
    setIsLoadingOrgs(true);
    setOrgError(null);
    client.organizations
      .list()
      .then((items) => {
        if (cancelled) return;
        setOrganizations(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setOrgError(err?.message ?? "Failed to load organizations");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOrgs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, organizations]);

  // Hover intent for organizations
  const handleOrgMouseEnter = useCallback((orgId: string) => {
    if (hoverOrgTimeoutRef.current) {
      clearTimeout(hoverOrgTimeoutRef.current);
    }
    hoverOrgTimeoutRef.current = setTimeout(() => {
      setHoverOrgId(orgId);
    }, 300);
  }, []);

  const handleOrgMouseLeave = useCallback(() => {
    if (hoverOrgTimeoutRef.current) {
      clearTimeout(hoverOrgTimeoutRef.current);
      hoverOrgTimeoutRef.current = null;
    }
  }, []);

  // Hover intent for agents
  const handleAgentMouseEnter = useCallback((agentId: string) => {
    if (hoverAgentTimeoutRef.current) {
      clearTimeout(hoverAgentTimeoutRef.current);
    }
    hoverAgentTimeoutRef.current = setTimeout(() => {
      setHoverAgentId(agentId);
    }, 200);
  }, []);

  const handleAgentMouseLeave = useCallback(() => {
    if (hoverAgentTimeoutRef.current) {
      clearTimeout(hoverAgentTimeoutRef.current);
      hoverAgentTimeoutRef.current = null;
    }
  }, []);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (hoverOrgTimeoutRef.current) {
        clearTimeout(hoverOrgTimeoutRef.current);
      }
      if (hoverAgentTimeoutRef.current) {
        clearTimeout(hoverAgentTimeoutRef.current);
      }
    };
  }, []);

  const activeOrg: Organization | null = useMemo(() => {
    const hovered = organizations?.find((o) => o.id === hoverOrgId) ?? null;
    return hovered ?? selectedOrganization ?? organizations?.[0] ?? null;
  }, [hoverOrgId, organizations, selectedOrganization]);

  // Load agents when active org changes
  useEffect(() => {
    if (!activeOrg) {
      setAgents(null);
      return;
    }
    let cancelled = false;
    setIsLoadingAgents(true);
    setAgentsError(null);
    client.agents
      .list({ organization_id: activeOrg.id, per_page: 100 })
      .then((resp) => {
        if (cancelled) return;
        const items = [...resp.items].sort(
          (a, b) => Number(b.pinned) - Number(a.pinned)
        );
        setAgents(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentsError(err?.message ?? "Failed to load agents");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAgents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, activeOrg?.id]);

  // Reset hover agent when switching organizations
  useEffect(() => {
    setHoverAgentId(null);
  }, [activeOrg?.id]);

  const handleClickOrg = (org: Organization) => {
    // Preserve the path when switching organizations
    // e.g., /oldorg/~/settings -> /neworg/~/settings
    if (selectedOrganization && pathname) {
      const pathAfterOrg = pathname.slice(selectedOrganization.name.length + 1);
      if (pathAfterOrg.startsWith("/~/")) {
        // Preserve organization-level paths like settings, people, etc.
        router.push(`/${org.name}${pathAfterOrg}`);
        return;
      }
    }
    router.push(`/${org.name}`);
  };

  const handleClickAgent = (org: Organization, agent: Agent) => {
    router.push(`/${org.name}/${agent.name}`);
  };

  const handleOrganizationCreated = () => {
    setOrganizations(null);
  };

  const activeAgentId = hoverAgentId ?? selectedAgent?.id ?? null;
  const previewAgent = useMemo(
    () => agents?.find((a) => a.id === hoverAgentId) ?? null,
    [agents, hoverAgentId]
  );

  // Filter organizations by search query
  const filteredOrganizations = useMemo(() => {
    if (!organizations) return null;
    if (!orgSearchQuery.trim()) return organizations;
    const query = orgSearchQuery.toLowerCase();
    return organizations.filter((org) =>
      org.name.toLowerCase().includes(query)
    );
  }, [organizations, orgSearchQuery]);

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!agents) return null;
    if (!agentSearchQuery.trim()) return agents;
    const query = agentSearchQuery.toLowerCase();
    return agents.filter((agent) => agent.name.toLowerCase().includes(query));
  }, [agents, agentSearchQuery]);

  return (
    <div
      className={cn(
        "bg-sidebar text-sidebar-foreground overflow-hidden rounded-md border border-sidebar-border shadow-md",
        "min-w-[540px] max-w-[720px] max-h-[80vh]",
        className
      )}
    >
      <div className="flex flex-row w-full h-full max-h-[80vh]">
        {/* Organizations column */}
        <div className="w-[240px] border-r border-sidebar-border flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-sidebar-border">
            <input
              ref={orgSearchInputRef}
              type="text"
              placeholder="Search organizations..."
              value={orgSearchQuery}
              onChange={(e) => setOrgSearchQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onFocus={(e) => e.stopPropagation()}
              className="w-full px-2 py-1.5 text-xs bg-transparent border border-sidebar-border rounded-md outline-none focus:border-sidebar-accent transition-colors placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-transparent">
            {isLoadingOrgs &&
              (!organizations || organizations.length === 0) && (
                <div className="p-2 space-y-1">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1.5"
                    >
                      <Skeleton className="h-[18px] w-[18px] rounded-sm" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              )}
            {orgError && (
              <div className="px-4 py-2 text-xs text-red-500">{orgError}</div>
            )}
            <div className="p-2 space-y-0.5">
              {filteredOrganizations?.map((org) => {
                const isPreview = activeOrg?.id === org.id;
                const isSelected = selectedOrganization?.id === org.id;
                return (
                  <DropdownMenuPrimitive.Item key={org.id} asChild>
                    <button
                      type="button"
                      onClick={() => handleClickOrg(org)}
                      onMouseEnter={() => handleOrgMouseEnter(org.id)}
                      onMouseLeave={handleOrgMouseLeave}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer outline-none transition-colors",
                        isPreview
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "hover:bg-sidebar-accent/50"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Avatar
                          seed={org.id}
                          src={org.avatar_url}
                          size={18}
                          className="rounded-sm border border-sidebar-border shrink-0"
                        />
                        <span className="truncate">{org.name}</span>
                      </div>
                      {isSelected && (
                        <svg
                          className="h-4 w-4 shrink-0 opacity-80"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </DropdownMenuPrimitive.Item>
                );
              })}
              <button
                type="button"
                onClick={() => setIsCreateOrgModalOpen(true)}
                className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent/50 transition-colors"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-sidebar-border text-xs shrink-0">
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span className="truncate">Create Organization</span>
              </button>
            </div>
          </div>
        </div>

        {/* Agents column */}
        <div
          className="w-[240px] flex flex-col overflow-hidden"
          onMouseLeave={() => {
            if (hoverAgentTimeoutRef.current) {
              clearTimeout(hoverAgentTimeoutRef.current);
              hoverAgentTimeoutRef.current = null;
            }
            setHoverAgentId(null);
          }}
        >
          <div className="px-3 py-2 border-b border-sidebar-border">
            <input
              ref={agentSearchInputRef}
              type="text"
              placeholder="Search agents..."
              value={agentSearchQuery}
              onChange={(e) => setAgentSearchQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onFocus={(e) => e.stopPropagation()}
              className="w-full px-2 py-1.5 text-xs bg-transparent border border-sidebar-border rounded-md outline-none focus:border-sidebar-accent transition-colors placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-transparent">
            {isLoadingAgents && (!agents || agents.length === 0) && (
              <div className="p-2 space-y-1">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                    <Skeleton className="h-[18px] w-[18px] rounded-[4px]" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            )}
            {agentsError && (
              <div className="px-4 py-2 text-xs text-red-500">
                {agentsError}
              </div>
            )}
            <div className="p-2 space-y-0.5">
              {filteredAgents?.map((agent) => {
                const active = activeAgentId === agent.id;
                const isSelectedAgent = selectedAgent?.id === agent.id;
                return (
                  <DropdownMenuPrimitive.Item key={agent.id} asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        activeOrg && handleClickAgent(activeOrg, agent)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activeOrg && handleClickAgent(activeOrg, agent);
                        }
                      }}
                      onMouseEnter={() => handleAgentMouseEnter(agent.id)}
                      onMouseLeave={handleAgentMouseLeave}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer outline-none transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "hover:bg-sidebar-accent/50"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Avatar
                          seed={agent.id}
                          src={agent.avatar_url}
                          size={18}
                          className="rounded-[4px] shrink-0"
                        />
                        <span className="truncate">{agent.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isSelectedAgent && (
                          <svg
                            className="h-4 w-4 opacity-80"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        <AgentPinned
                          agentID={agent.id}
                          pinned={!!agent.pinned}
                          variant="icon"
                        />
                      </div>
                    </div>
                  </DropdownMenuPrimitive.Item>
                );
              })}
              {activeOrg && (
                <DropdownMenuPrimitive.Item asChild>
                  <Link
                    href={`/new?org=${activeOrg.name}`}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent/50 cursor-pointer outline-none transition-colors"
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-sidebar-border text-xs shrink-0">
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                    <span className="truncate">Create Agent</span>
                  </Link>
                </DropdownMenuPrimitive.Item>
              )}
            </div>
          </div>
        </div>

        {/* Details panel */}
        <div className="w-[240px] border-l border-sidebar-border p-4 hidden md:flex md:flex-col overflow-hidden">
          {previewAgent ? (
            <div className="flex flex-col gap-3 h-full overflow-hidden">
              <div className="flex items-center gap-2 shrink-0">
                <Avatar
                  seed={previewAgent.id}
                  src={previewAgent.avatar_url}
                  size={20}
                  className="rounded-[4px] shrink-0"
                />
                <div className="font-medium truncate">{previewAgent.name}</div>
              </div>
              <div className="text-sm opacity-80 whitespace-pre-wrap break-words overflow-y-auto flex-1 scrollbar-transparent">
                {previewAgent.description || "No description"}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <CreateOrganizationModal
        open={isCreateOrgModalOpen}
        onOpenChange={setIsCreateOrgModalOpen}
        onSuccess={handleOrganizationCreated}
      />
    </div>
  );
}
