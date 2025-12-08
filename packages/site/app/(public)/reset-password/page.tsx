"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Client from "@blink.so/api";
import { useMemo, useState } from "react";

export default function ResetPasswordPage() {
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
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            Reset your password
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Enter your email address and we'll send you a link to reset your
            password
          </p>
        </div>

        {/* Reset Password Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-lg p-8">
          <div className="space-y-4">
            {/* Error Display */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-sm text-red-800 dark:text-red-200">
                  {error}
                </p>
              </div>
            )}

            {/* Reset Password Form */}
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

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Remember your password?{" "}
              <a
                href="/login"
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>

        {/* Terms */}
        <div className="mt-6 text-center">
          <p className="text-xs text-neutral-500">
            Need help? Contact our{" "}
            <a
              href="mailto:support@blink.coder.com"
              className="hover:underline"
            >
              support team
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
