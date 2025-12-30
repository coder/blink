import {
  decodeEmailVerificationToken,
  emailVerificationTokenCookieName,
} from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailVerificationForm } from "./form";

export const metadata: Metadata = {
  title: "Check your inbox - Blink",
  description: "Verify your email address to continue",
  robots: { index: false, follow: false },
};

interface EmailVerificationPageProps {
  searchParams: { error?: string; resent?: string; redirect?: string };
}

export default async function EmailVerificationPage({
  searchParams,
}: EmailVerificationPageProps) {
  const store = await cookies();
  const token = store.get(emailVerificationTokenCookieName);
  const { error, resent, redirect: redirectTarget } = await searchParams;
  if (!token) {
    const next = redirectTarget
      ? `/login?redirect=${encodeURIComponent(redirectTarget)}`
      : "/login";
    redirect(next);
  }
  const decoded = await decodeEmailVerificationToken(token.value);
  if (!decoded) {
    const next = redirectTarget
      ? `/login?redirect=${encodeURIComponent(redirectTarget)}`
      : "/login";
    redirect(next);
  }

  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            Check your inbox
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Enter the verification code we just sent to {decoded.email}.
          </p>
        </div>

        {/* Email Verification Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-lg p-8">
          <div className="space-y-4">
            {/* Verification Form */}
            <EmailVerificationForm redirect={redirectTarget} />
          </div>
        </div>

        {/* Terms */}
        <div className="mt-6 text-center">
          <p className="text-xs text-neutral-500">
            <Link href="/terms" className="hover:underline">
              Terms of Use
            </Link>
            {" | "}
            <Link href="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
