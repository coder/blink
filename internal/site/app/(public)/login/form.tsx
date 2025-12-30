"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Client from "@blink.so/api";
import { useState } from "react";

type FieldErrors = {
  email?: string;
  password?: string;
};

export function LoginForm({
  redirect,
  lastProvider,
}: {
  redirect?: string;
  lastProvider?: "credentials" | "github" | "google";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>(
    {
      email: false,
      password: false,
    }
  );

  const validateEmail = (email: string): string | undefined => {
    if (!email) return "Email is required";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Please enter a valid email address";
    return undefined;
  };

  const validatePassword = (password: string): string | undefined => {
    if (!password) return "Password is required";
    return undefined;
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    if (touched.email) {
      const error = validateEmail(value);
      setFieldErrors((prev) => ({ ...prev, email: error }));
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    if (touched.password) {
      const error = validatePassword(value);
      setFieldErrors((prev) => ({ ...prev, password: error }));
    }
  };

  const handleEmailBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setTouched((prev) => ({ ...prev, email: true }));
    const error = validateEmail(e.target.value);
    setFieldErrors((prev) => ({ ...prev, email: error }));
  };

  const handlePasswordBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setTouched((prev) => ({ ...prev, password: true }));
    const error = validatePassword(e.target.value);
    setFieldErrors((prev) => ({ ...prev, password: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate all fields
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    setFieldErrors({
      email: emailError,
      password: passwordError,
    });

    setTouched({ email: true, password: true });

    if (emailError || passwordError) {
      return;
    }

    setIsSubmitting(true);

    try {
      const client = new Client();
      await client.auth.signInWithCredentials({ email, password });

      // Redirect on success
      window.location.href = redirect || "/chat";
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "Failed to sign in");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
          placeholder="Enter your email"
          value={email}
          disabled={isSubmitting}
          className={cn(
            "w-full",
            fieldErrors.email && touched.email
              ? "border-red-500 focus-visible:ring-red-500 dark:border-red-500 dark:focus-visible:ring-red-500"
              : ""
          )}
          onChange={handleEmailChange}
          onBlur={handleEmailBlur}
        />
        {fieldErrors.email && touched.email && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-zinc-900 dark:text-white mb-2"
        >
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Enter your password"
          value={password}
          disabled={isSubmitting}
          className={cn(
            "w-full",
            fieldErrors.password && touched.password
              ? "border-red-500 focus-visible:ring-red-500 dark:border-red-500 dark:focus-visible:ring-red-500"
              : ""
          )}
          onChange={handlePasswordChange}
          onBlur={handlePasswordBlur}
        />
        {fieldErrors.password && touched.password && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {fieldErrors.password}
          </p>
        )}
        <div className="mt-2 text-right">
          <a
            href="/reset-password"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
            data-testid="forgot-password-link"
          >
            Forgot password?
          </a>
        </div>
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
        <span className="inline-flex items-center">
          {isSubmitting ? "Signing in..." : "Sign In"}
          {!isSubmitting && lastProvider === "credentials" ? (
            <Badge variant="secondary" className="ml-2">
              Last
            </Badge>
          ) : null}
        </span>
      </Button>
    </form>
  );
}
