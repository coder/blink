"use client";

import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Client from "@blink.so/api";
import { Code, Lock, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

type Target = "preview" | "production";

type AgentEnvironmentVariable = {
  id: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  key: string;
  value: string | null;
  secret: boolean;
  target: Array<"preview" | "production">;
};

export default function EnvManager({
  agentId,
  organizationId,
}: {
  agentId: string;
  organizationId: string;
}) {
  const client = useMemo(() => new Client(), []);
  const [loading, setLoading] = useState(true);
  const [envs, setEnvs] = useState<AgentEnvironmentVariable[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newSecret, setNewSecret] = useState(false);
  const [newTargets, setNewTargets] = useState<Target[]>([
    "preview",
    "production",
  ]);
  const [saving, setSaving] = useState(false);

  const fetchEnvs = async () => {
    try {
      const list = await client.agents.env.list({ agent_id: agentId });
      setEnvs(list);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to load environment variables"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const addEnv = async () => {
    if (!newKey.trim()) {
      toast.error("Key is required");
      return;
    }
    if (!newSecret && !newValue.trim()) {
      toast.error("Value is required for non-secret variables");
      return;
    }
    if (newTargets.length === 0) {
      toast.error("At least one environment is required");
      return;
    }
    setSaving(true);
    try {
      await client.agents.env.create({
        agent_id: agentId,
        key: newKey.trim(),
        value: newValue,
        secret: newSecret,
        target: newTargets,
      });
      setNewKey("");
      setNewValue("");
      setNewSecret(false);
      setNewTargets(["preview", "production"]);
      await fetchEnvs();
      toast.success("Environment variable created");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create variable"
      );
    } finally {
      setSaving(false);
    }
  };

  const removeEnv = async (env: AgentEnvironmentVariable) => {
    try {
      await client.agents.env.delete({ agent_id: agentId, id: env.id });
      await fetchEnvs();
      toast.success("Environment variable deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete variable"
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Environment variables are encrypted at rest and exposed to your agent
          at runtime. Changes to variables require redeployment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Variable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-key">Variable Name</Label>
              <Input
                id="new-key"
                placeholder="API_KEY"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="font-mono"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-value">Value</Label>
              <Input
                id="new-value"
                type={newSecret ? "password" : "text"}
                placeholder={newSecret ? "••••••••" : "Value"}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="font-mono"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Environments</Label>
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="new-preview"
                  checked={newTargets.includes("preview")}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setNewTargets([...newTargets, "preview"]);
                    } else {
                      setNewTargets(newTargets.filter((t) => t !== "preview"));
                    }
                  }}
                />
                <label
                  htmlFor="new-preview"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Preview
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="new-production"
                  checked={newTargets.includes("production")}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setNewTargets([...newTargets, "production"]);
                    } else {
                      setNewTargets(
                        newTargets.filter((t) => t !== "production")
                      );
                    }
                  }}
                />
                <label
                  htmlFor="new-production"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Production
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="new-secret"
              checked={newSecret}
              onCheckedChange={(checked) => setNewSecret(checked === true)}
            />
            <label
              htmlFor="new-secret"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Store as secret (value will be encrypted and hidden)
            </label>
          </div>

          <Button onClick={addEnv} disabled={saving} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Variable
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            Loading environment variables…
          </div>
        ) : envs.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No environment variables yet. Add one above to get started.
          </div>
        ) : (
          envs.map((env) => (
            <EnvRow
              key={env.id}
              env={env}
              agentId={agentId}
              organizationId={organizationId}
              onUpdate={fetchEnvs}
              onDelete={removeEnv}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EnvRow({
  env,
  agentId,
  organizationId,
  onUpdate,
  onDelete,
}: {
  env: AgentEnvironmentVariable;
  agentId: string;
  organizationId: string;
  onUpdate: () => Promise<void>;
  onDelete: (env: AgentEnvironmentVariable) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editKey, setEditKey] = useState(env.key);
  const [editValue, setEditValue] = useState(
    env.secret ? "" : (env.value ?? "")
  );
  const [editTargets, setEditTargets] = useState<Target[]>(
    env.target as Target[]
  );
  const [saving, setSaving] = useState(false);
  const client = useMemo(() => new Client(), []);

  const handleSave = async () => {
    if (!editKey.trim()) {
      toast.error("Variable name is required");
      return;
    }
    if (!env.secret && !editValue.trim()) {
      toast.error("Value is required for non-secret variables");
      return;
    }
    if (editTargets.length === 0) {
      toast.error("At least one environment is required");
      return;
    }

    setSaving(true);
    try {
      await client.agents.env.update({
        agent_id: agentId,
        id: env.id,
        key: editKey.trim(),
        value: env.secret && !editValue ? undefined : editValue,
        secret: env.secret,
        target: editTargets,
      });
      setIsEditing(false);
      await onUpdate();
      toast.success("Environment variable updated");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update variable"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await onDelete(env);
    setShowDeleteDialog(false);
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "just now";
    if (minutes < 60)
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
    return new Date(date).toLocaleDateString();
  };

  const formatEnvironments = (targets: Target[]) => {
    if (targets.length === 2) return "Preview and Production";
    if (targets.length === 1)
      return targets[0].charAt(0).toUpperCase() + targets[0].slice(1);
    return "None";
  };

  const isUpdated = new Date(env.updated_at) > new Date(env.created_at);
  const displayDate = isUpdated ? env.updated_at : env.created_at;
  const displayVerb = isUpdated ? "Updated" : "Added";
  const displayUserId = isUpdated ? env.updated_by : env.created_by;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className="flex-shrink-0 mt-1">
              {env.secret ? (
                <Lock className="w-5 h-5 text-muted-foreground" />
              ) : (
                <Code className="w-5 h-5 text-muted-foreground" />
              )}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-medium">{env.key}</span>
                {env.secret && (
                  <Badge variant="secondary" className="text-xs">
                    Secret
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatEnvironments(env.target as Target[])}
              </div>
            </div>

            {/* Value */}
            <div className="flex-shrink-0 w-48">
              {env.secret ? (
                <span className="text-sm text-muted-foreground italic">
                  Hidden
                </span>
              ) : (
                <span className="text-sm font-mono break-all">
                  {env.value || "—"}
                </span>
              )}
            </div>

            {/* Metadata */}
            <div className="flex-shrink-0 flex items-center gap-3">
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">
                  {displayVerb} {formatTimeAgo(displayDate)}
                </span>
                <UserAvatar
                  userId={displayUserId}
                  organizationId={organizationId}
                />
              </div>

              {/* Actions dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsEditing(!isEditing)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Edit form */}
          {isEditing && (
            <div className="mt-4 pt-4 border-t space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`edit-key-${env.id}`}>Variable Name</Label>
                  <Input
                    id={`edit-key-${env.id}`}
                    value={editKey}
                    onChange={(e) => setEditKey(e.target.value)}
                    className="font-mono"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`edit-value-${env.id}`}>
                    Value
                    {env.secret && (
                      <span className="text-xs text-muted-foreground ml-2">
                        (leave blank to keep current)
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`edit-value-${env.id}`}
                    type={env.secret ? "password" : "text"}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={env.secret ? "••••••••" : ""}
                    className="font-mono"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Environments</Label>
                <div className="flex items-center gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-preview-${env.id}`}
                      checked={editTargets.includes("preview")}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setEditTargets([...editTargets, "preview"]);
                        } else {
                          setEditTargets(
                            editTargets.filter((t) => t !== "preview")
                          );
                        }
                      }}
                    />
                    <label
                      htmlFor={`edit-preview-${env.id}`}
                      className="text-sm font-medium"
                    >
                      Preview
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-production-${env.id}`}
                      checked={editTargets.includes("production")}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setEditTargets([...editTargets, "production"]);
                        } else {
                          setEditTargets(
                            editTargets.filter((t) => t !== "production")
                          );
                        }
                      }}
                    />
                    <label
                      htmlFor={`edit-production-${env.id}`}
                      className="text-sm font-medium"
                    >
                      Production
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setEditKey(env.key);
                    setEditValue(env.secret ? "" : (env.value ?? ""));
                    setEditTargets(env.target as Target[]);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Environment Variable</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{env.key}</strong>? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserAvatar({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const client = useMemo(() => new Client(), []);
  const { data } = useSWR(
    userId ? `org-member-${organizationId}-${userId}` : null,
    () =>
      client.organizations.members.get({
        organization_id: organizationId,
        user_id: userId,
      })
  );

  const user = data?.user;
  if (!user) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Avatar
              src={user.avatar_url}
              seed={user.id}
              size={24}
              className="rounded-full"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>{user.username || user.email}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
