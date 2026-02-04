"use client";

import Client from "@blink.so/api";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ResetPasswordForm() {
  const client = useMemo(() => new Client(), []);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(undefined);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;

    if (!email) {
      setError("Please enter your email address");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await client.auth.requestPasswordReset({ email });
      if (result.ok && result.redirect_url) {
        window.location.href = result.redirect_url;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to request password reset"
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-zinc-900 dark:text-white mb-2"
          >
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="Enter your email address"
            className="w-full"
            data-testid="reset-email-input"
          />
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full h-12 text-base font-medium"
          data-testid="reset-email-submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Sending..." : "Send Reset Code"}
        </Button>
      </form>
    </div>
  );
}
