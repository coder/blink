import {
  decodeEmailVerificationToken,
  emailVerificationTokenCookieName,
} from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PasswordResetVerificationForm } from "./form";

export const metadata: Metadata = {
  title: "Enter reset code - Blink",
  description: "Verify the reset code to continue",
};

interface ResetVerificationPageProps {
  searchParams: { error?: string; resent?: string };
}

export default async function ResetVerificationPage({
  searchParams,
}: ResetVerificationPageProps) {
  const store = await cookies();
  const token = store.get(emailVerificationTokenCookieName);
  if (!token) {
    redirect("/reset-password");
  }
  const decoded = await decodeEmailVerificationToken(token.value);
  if (!decoded) {
    redirect("/reset-password");
  }

  const { error, resent } = await searchParams;

  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            Check your inbox
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Enter the reset code we just sent to {decoded.email}.
          </p>
        </div>

        {/* Verification Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-lg p-8">
          <div className="space-y-4">
            <PasswordResetVerificationForm />
          </div>
        </div>
      </div>
    </div>
  );
}
