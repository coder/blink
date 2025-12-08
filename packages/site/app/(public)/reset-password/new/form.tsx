"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Client from "@blink.so/api";
import { useState } from "react";

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);

    try {
      const client = new Client();
      await client.auth.resetPassword({ password });

      // Redirect to login on success
      window.location.href = "/login?reset=1";
    } catch (err) {
      console.error("Password reset error:", err);
      setError(err instanceof Error ? err.message : "Failed to reset password");
      setIsSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-zinc-900 dark:text-white mb-2"
        >
          New password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          placeholder="Enter a new password"
          className="w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
          data-testid="new-password-input"
        />
      </div>
      <div>
        <label
          htmlFor="confirm"
          className="block text-sm font-medium text-zinc-900 dark:text-white mb-2"
        >
          Confirm password
        </label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          placeholder="Re-enter your new password"
          className="w-full"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isSubmitting}
          data-testid="new-password-confirm-input"
        />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full h-12 text-base font-medium"
        disabled={isSubmitting}
        data-testid="new-password-submit"
      >
        {isSubmitting ? "Saving..." : "Save password"}
      </Button>
    </form>
  );
}
