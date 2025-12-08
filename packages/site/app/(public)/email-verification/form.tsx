"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Client from "@blink.so/api";
import { useState } from "react";

export function EmailVerificationForm({ redirect }: { redirect?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const client = new Client();
      await client.auth.verifyEmail({ code });

      // Redirect on success
      window.location.href = redirect || "/chat";
    } catch (err) {
      console.error("Verification error:", err);
      setError(err instanceof Error ? err.message : "Invalid code");
      setIsSubmitting(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendError(null);
    setResendSuccess(false);
    setResendLoading(true);

    try {
      const client = new Client();
      await client.auth.resendEmailVerification();
      setResendSuccess(true);
    } catch (err) {
      setResendError(
        err instanceof Error ? err.message : "Failed to resend email"
      );
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-zinc-900 dark:text-white mb-2"
          >
            Code
          </label>
          <Input
            id="code"
            name="code"
            type="text"
            required
            placeholder="Enter verification code"
            className="w-full"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isSubmitting}
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
        >
          {isSubmitting ? "Verifying..." : "Continue"}
        </Button>
      </form>

      <div className="text-center">
        <form onSubmit={handleResend}>
          <button
            type="submit"
            disabled={resendLoading}
            className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-zinc-900 dark:hover:text-white underline disabled:opacity-60"
          >
            {resendLoading ? "Sending..." : "Resend email"}
          </button>
        </form>
        {resendSuccess && (
          <p className="mt-2 text-xs text-green-700 dark:text-green-400">
            Verification email sent
          </p>
        )}
        {resendError && (
          <p className="mt-2 text-xs text-red-800 dark:text-red-300">
            {resendError}
          </p>
        )}
      </div>
    </div>
  );
}
