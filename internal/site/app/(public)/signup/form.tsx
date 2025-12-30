"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Client from "@blink.so/api";
import { useMemo, useState } from "react";

type FieldErrors = {
  email?: string;
  password?: string;
};

export function SignupForm({ redirect }: { redirect?: string }) {
  const client = useMemo(() => new Client(), []);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    if (password.length < 8)
      return "Password must be at least 8 characters long";
    return undefined;
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const email = e.target.value;
    if (touched.email) {
      const error = validateEmail(email);
      setFieldErrors((prev) => ({ ...prev, email: error }));
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const password = e.target.value;
    if (touched.password) {
      const error = validatePassword(password);
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(undefined);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    // Validate both fields
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    if (emailError || passwordError) {
      setFieldErrors({
        email: emailError,
        password: passwordError,
      });
      setTouched({ email: true, password: true });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await client.auth.signup({ email, password, redirect });
      if (result.ok && result.redirect_url) {
        window.location.href = result.redirect_url;
      }
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Failed to create account"
      );
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="redirect" value={redirect ?? ""} />
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
          className={cn(
            "w-full",
            fieldErrors.password && touched.password
              ? "border-red-500 focus-visible:ring-red-500 dark:border-red-500 dark:focus-visible:ring-red-500"
              : ""
          )}
          minLength={8}
          onChange={handlePasswordChange}
          onBlur={handlePasswordBlur}
        />
        {fieldErrors.password && touched.password ? (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {fieldErrors.password}
          </p>
        ) : (
          <p className="text-xs text-neutral-500 mt-1">
            Password must be at least 8 characters long
          </p>
        )}
      </div>

      {serverError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">
            {serverError}
          </p>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full h-12 text-base font-medium"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Creating account..." : "Create Account"}
      </Button>
    </form>
  );
}
