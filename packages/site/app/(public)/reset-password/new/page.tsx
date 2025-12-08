import {
  decodePasswordResetVerifiedToken,
  passwordResetVerifiedCookieName,
} from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NewPasswordForm } from "./form";

export const metadata: Metadata = {
  title: "Set new password - Blink",
  description: "Choose a new password",
};

export default async function ResetPasswordNewPage() {
  const store = await cookies();
  const cookie = store.get(passwordResetVerifiedCookieName);
  if (!cookie) {
    redirect("/reset-password");
  }
  const decoded = await decodePasswordResetVerifiedToken(cookie.value);
  if (!decoded?.email) {
    redirect("/reset-password");
  }

  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            Create a new password
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Your email {decoded.email} was verified. Choose a new password.
          </p>
        </div>

        {/* New Password Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-lg p-8">
          <NewPasswordForm />
        </div>
      </div>
    </div>
  );
}
