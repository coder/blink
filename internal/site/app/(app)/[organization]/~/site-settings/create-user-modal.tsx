"use client";

import type { SiteRole } from "@blink.so/api";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAPIClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onUserCreated: () => void;
  /** Initial error message to display (for Storybook) */
  initialError?: string;
}

type FieldErrors = {
  email?: string;
  password?: string;
};

export function CreateUserModal({
  open,
  onClose,
  onUserCreated,
  initialError,
}: CreateUserModalProps) {
  const client = useAPIClient();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [siteRole, setSiteRole] = useState<SiteRole>("member");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setSiteRole("member");
    setError(null);
    setFieldErrors({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validateEmail = (email: string): string | undefined => {
    if (!email) return "Email is required";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Please enter a valid email address";
    return undefined;
  };

  const validatePassword = (password: string): string | undefined => {
    if (!password) return "Password is required";
    if (password.length < 8) return "Password must be at least 8 characters";
    return undefined;
  };

  const handleCreate = async () => {
    setError(null);

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    setFieldErrors({
      email: emailError,
      password: passwordError,
    });

    if (emailError || passwordError) {
      return;
    }

    setLoading(true);

    try {
      await client.admin.users.create({
        email,
        password,
        site_role: siteRole,
        authentication_type: "password",
      });

      onUserCreated();
      handleClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message || "Failed to create user");
      } else {
        setError("Failed to create user");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create new user</DialogTitle>
          <DialogDescription>
            Create a new user account with password authentication
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    email: validateEmail(e.target.value),
                  }));
                }
              }}
              className={cn(
                fieldErrors.email &&
                  "border-red-500 focus-visible:ring-red-500 dark:border-red-500 dark:focus-visible:ring-red-500"
              )}
            />
            {fieldErrors.email && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => ({
                      ...prev,
                      password: validatePassword(e.target.value),
                    }));
                  }
                }}
                className={cn(
                  "pr-10",
                  fieldErrors.password &&
                    "border-red-500 focus-visible:ring-red-500 dark:border-red-500 dark:focus-visible:ring-red-500"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {fieldErrors.password ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {fieldErrors.password}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Must be at least 8 characters
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="siteRole">Role</Label>
            <select
              id="siteRole"
              value={siteRole}
              onChange={(e) => setSiteRole(e.target.value as SiteRole)}
              className="w-full h-10 px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
